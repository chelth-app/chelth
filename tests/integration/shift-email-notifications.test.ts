import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EmailMessage, EmailSender, EmailSendResult } from "@/lib/email/types";
import { dispatchNotifications } from "@/lib/notifications";
import { createPostgresNotificationStore } from "@/lib/notifications/postgres-store";

import { uniqueEmail } from "../support/mailpit";
import { ownerQuery, signUpVerified, stepUpToAal2, type TestIdentity } from "./support/identities";
import {
  activateCna,
  assign,
  blsEvidence,
  createAgency,
  facilityWithRelationship,
  invite,
  isoDay,
  must,
  run,
  workerIdAt,
} from "./support/staffing";

/**
 * Shift email notifications (P0-E9-3G) end to end: domain RPC → outbox (same
 * transaction) → least-privilege dispatcher → template → sender (a fake
 * provider; never real email). Retries and claim races are covered by
 * notifications-operations.test.ts and pgTAP 140 / 290.
 */

const WORKER_ROLE = "chelth_notifier_it";
const WORKER_PASSWORD = "local-integration-only";
const WORKER_URL = `postgresql://${WORKER_ROLE}:${WORKER_PASSWORD}@127.0.0.1:55322/postgres`;
const BASE = "http://localhost:3000";

function recordingSender(
  result: () => EmailSendResult,
): EmailSender & { messages: EmailMessage[] } {
  const messages: EmailMessage[] = [];
  return {
    provider: "fake",
    messages,
    async send(message) {
      messages.push(message);
      return result();
    },
  };
}
const ok = (): EmailSendResult => ({ status: "sent", provider: "fake", providerMessageId: "fake" });
const down = (): EmailSendResult => ({
  status: "failed",
  provider: "fake",
  errorCode: "provider_unavailable",
});

/** Only the given rows are due (deterministic batches). */
async function onlyDue(ids: string[]) {
  await ownerQuery(
    (sql) => sql`update internal.notification_outbox
                 set next_attempt_at = case when id = any(${ids}::uuid[]) then now() - interval '1 second'
                                            else now() + interval '1 day' end
                 where state in ('pending', 'retry')`,
  );
}

async function rows(event: string, subjectId: string) {
  return ownerQuery(
    (sql) => sql<{ id: string; state: string; attempts: number; last_error_code: string | null }[]>`
      select id, state::text, attempts, last_error_code from internal.notification_outbox
      where event::text = ${event} and subject_id = ${subjectId}::uuid order by created_at`,
  );
}

describe("shift email notifications (P0-E9-3G)", () => {
  let admin: TestIdentity;
  let scheduler: TestIdentity;
  let worker: { identity: TestIdentity; id: string };
  let facility: { facilityId: string; locationId: string };
  let alphaId: string;
  let store: ReturnType<typeof createPostgresNotificationStore>;
  let shiftId: string;
  let assignmentId: string;

  beforeAll(async () => {
    await ownerQuery(async (sql) => {
      const exists = await sql`select 1 from pg_roles where rolname = ${WORKER_ROLE}`;
      if (exists.length === 0) {
        await sql.unsafe(
          `create role ${WORKER_ROLE} login password '${WORKER_PASSWORD}' in role chelth_notification_worker`,
        );
      }
      return [];
    });
    store = createPostgresNotificationStore(WORKER_URL);
    admin = await signUpVerified("mail-alpha");
    alphaId = await createAgency(admin, "Alpha Mail Staffing");
    await stepUpToAal2(admin);
    scheduler = await invite(admin.client, alphaId, "agency.scheduler", uniqueEmail("mail-sched"));
    await run(
      admin.client.rpc("create_credential_requirement", {
        p_effective_from: isoDay(-30),
        p_agency_organisation_id: alphaId,
        p_credential_type_key: "bls_certification",
      }),
    );
    const identity = await invite(
      admin.client,
      alphaId,
      "agency.healthcare_worker",
      uniqueEmail("mail-w"),
    );
    const id = await workerIdAt(identity, alphaId);
    await activateCna(admin.client, id);
    await blsEvidence(identity, 400, [{ client: admin.client, organisationId: alphaId }]);
    worker = { identity, id };
    facility = await facilityWithRelationship(
      admin.client,
      alphaId,
      "Harbor Clinic",
      "America/New_York",
    );
    shiftId = await must(
      scheduler.client.rpc("create_shift", {
        p_agency_facility_id: facility.facilityId,
        p_facility_location_id: facility.locationId,
        p_discipline_key: "cna",
        p_shift_date: isoDay(3),
        p_start_time: "07:00",
        p_end_time: "15:00",
        p_requested_headcount: 1,
        p_open: true,
      }),
    );
    // Only this suite's rows are dispatched.
    await ownerQuery(
      (
        sql,
      ) => sql`update internal.notification_outbox set next_attempt_at = now() + interval '1 day'
                   where state in ('pending', 'retry')`,
    );
  }, 180_000);

  afterAll(async () => {
    await store?.close();
  });

  it("assignment ⇒ one email after commit, deep-linked; a second dispatcher run sends nothing", async () => {
    const decision = await assign(scheduler.client, shiftId, worker.id);
    assignmentId = decision.assignment_id ?? "";
    const queued = await rows("worker_assigned", assignmentId);
    expect(queued).toHaveLength(1);
    await onlyDue(queued.map((row) => row.id));

    const sender = recordingSender(ok);
    await dispatchNotifications({ store, sender, baseUrl: BASE });
    expect(sender.messages).toHaveLength(1);
    const [message] = sender.messages;
    expect(message?.to).toBe(worker.identity.email);
    expect(message?.subject).toBe("You have a new shift");
    expect(message?.text).toContain("Facility: Harbor Clinic");
    expect(message?.text).toContain(
      `${BASE}/app/organisations/${alphaId}/my-shifts/${assignmentId}`,
    );
    expect(message?.text).not.toMatch(/\$|rate|latitude|credential/i);

    // Duplicate dispatcher run: nothing left to claim.
    const again = recordingSender(ok);
    await dispatchNotifications({ store, sender: again, baseUrl: BASE });
    expect(again.messages).toHaveLength(0);
    expect((await rows("worker_assigned", assignmentId))[0]?.state).toBe("sent");
  });

  it("acceptance sends nothing more; a unit change emails once; a provider failure retries and never undoes the shift", async () => {
    await run(
      worker.identity.client.rpc("accept_shift_assignment", { p_assignment_id: assignmentId }),
    );
    await run(scheduler.client.rpc("set_shift_unit", { p_shift_id: shiftId, p_unit_label: "ICU" }));
    const changed = await rows("shift_changed", assignmentId);
    expect(changed).toHaveLength(1);
    await onlyDue(changed.map((row) => row.id));

    const failing = recordingSender(down);
    await dispatchNotifications({ store, sender: failing, baseUrl: BASE });
    expect((await rows("shift_changed", assignmentId))[0]).toMatchObject({
      state: "retry",
      last_error_code: "provider_unavailable",
    });
    // The assignment is authoritative and untouched by email failure.
    const assignment = await must(
      worker.identity.client
        .from("shift_assignments")
        .select("status")
        .eq("id", assignmentId)
        .single(),
    );
    expect(assignment.status).toBe("accepted");

    await onlyDue(changed.map((row) => row.id));
    const sender = recordingSender(ok);
    await dispatchNotifications({ store, sender, baseUrl: BASE });
    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0]?.subject).toBe("Your shift has been updated");
    expect(sender.messages[0]?.text).toContain("Updated unit: ICU");
    // The worker never sees the provider error.
    expect(sender.messages[0]?.text).not.toContain("provider");
  });

  it("24 h reminder in the facility's calendar; then cancellation ⇒ one cancellation email and no reminder", async () => {
    const start = await ownerQuery(
      (sql) =>
        sql<{ start_at: Date }[]>`select start_at from public.shifts where id = ${shiftId}::uuid`,
    );
    await ownerQuery(
      (sql) =>
        sql`select internal.run_shift_reminder_scan(${start[0]?.start_at ?? new Date()}::timestamptz - interval '20 hours')`,
    );
    const reminder = await rows("shift_reminder", assignmentId);
    expect(reminder).toHaveLength(1);
    await onlyDue(reminder.map((row) => row.id));
    const sender = recordingSender(ok);
    await dispatchNotifications({ store, sender, baseUrl: BASE });
    expect(sender.messages[0]?.subject).toMatch(/^Reminder: your shift is /);

    await run(
      scheduler.client.rpc("cancel_shift", {
        p_shift_id: shiftId,
        p_reason: "staffing_no_longer_needed",
      }),
    );
    const cancelled = await rows("shift_cancelled", assignmentId);
    expect(cancelled).toHaveLength(1);
    await onlyDue(cancelled.map((row) => row.id));
    const cancelSender = recordingSender(ok);
    await dispatchNotifications({ store, sender: cancelSender, baseUrl: BASE });
    expect(cancelSender.messages[0]?.subject).toBe("Your shift has been cancelled");
    expect(cancelSender.messages[0]?.text).toContain("You do not need to attend.");

    await ownerQuery(
      (sql) =>
        sql`select internal.run_shift_reminder_scan(${start[0]?.start_at ?? new Date()}::timestamptz - interval '10 hours')`,
    );
    expect(await rows("shift_reminder", assignmentId)).toHaveLength(1);
  });
});
