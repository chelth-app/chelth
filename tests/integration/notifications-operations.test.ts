import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EmailSender, EmailSendResult } from "@/lib/email/types";
import { dispatchNotifications, NOTIFICATION_EVENTS } from "@/lib/notifications";
import { createPostgresNotificationStore } from "@/lib/notifications/postgres-store";

import { uniqueEmail } from "../support/mailpit";
import {
  grantPlatformAdmin,
  ownerQuery,
  signUpVerified,
  slug,
  stepUpToAal2,
  type TestIdentity,
} from "./support/identities";
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
 * Assignment operations & notifications (P0-E5-S2) against the local stack:
 * outbox fan-out and consumption through the least-privilege dispatcher role
 * (deterministic fake provider — never real email), bounded retries,
 * readiness monitoring, relationship suspension, and shift offers including
 * the race for the last slot.
 */

// Local-only LOGIN role inside chelth_notification_worker (the operator step, locally).
const WORKER_ROLE = "chelth_notifier_it";
const WORKER_PASSWORD = "local-integration-only";
const WORKER_URL = `postgresql://${WORKER_ROLE}:${WORKER_PASSWORD}@127.0.0.1:55322/postgres`;

function fakeSender(script: (to: string) => EmailSendResult): EmailSender & { sentTo: string[] } {
  const sentTo: string[] = [];
  return {
    provider: "fake",
    sentTo,
    async send(message) {
      sentTo.push(message.to);
      return script(message.to);
    },
  };
}

const ok: EmailSendResult = { status: "sent", provider: "fake", providerMessageId: "fake-msg" };

async function outbox(where: { event?: string; subjectId?: string }) {
  return ownerQuery(
    (sql) => sql<
      {
        id: string;
        event: string;
        state: string;
        recipient_profile_id: string;
        attempts: number;
        last_error_code: string | null;
        provider_message_id: string | null;
      }[]
    >`
      select id, event::text, state::text, recipient_profile_id, attempts, last_error_code, provider_message_id
      from internal.notification_outbox
      where (${where.event ?? null}::text is null or event::text = ${where.event ?? null})
        and (${where.subjectId ?? null}::uuid is null or subject_id = ${where.subjectId ?? null}::uuid)`,
  );
}

/** Keeps only the rows a test cares about due, so batches are deterministic. */
async function onlyDue(ids: string[]) {
  await ownerQuery(
    (sql) => sql`update internal.notification_outbox
                 set next_attempt_at = case when id = any(${ids}::uuid[]) then now() - interval '1 second'
                                            else now() + interval '1 day' end
                 where state in ('pending', 'retry')`,
  );
}

describe("assignment operations & notifications (P0-E5-S2)", () => {
  let admin: TestIdentity;
  let scheduler: TestIdentity;
  let betaAdmin: TestIdentity;
  let facilityAdmin: TestIdentity;
  let wendy: TestIdentity;
  let walt: TestIdentity;
  let alphaId: string;
  let gammaId: string;
  const w: Record<string, string> = {};
  let mercy: { facilityId: string; locationId: string; relationshipId: string };
  let store: ReturnType<typeof createPostgresNotificationStore>;

  function openShift(day: number, start: string, end: string, headcount = 1) {
    return must(
      scheduler.client.rpc("create_shift", {
        p_agency_facility_id: mercy.facilityId,
        p_facility_location_id: mercy.locationId,
        p_discipline_key: "cna",
        p_shift_date: isoDay(day),
        p_start_time: start,
        p_end_time: end,
        p_requested_headcount: headcount,
        p_open: true,
      }),
    );
  }

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

    [admin, betaAdmin] = await Promise.all([
      signUpVerified("ops-alpha"),
      signUpVerified("ops-beta"),
    ]);
    alphaId = await createAgency(admin, "Alpha Operations Staffing");
    await createAgency(betaAdmin, "Beta Operations Staffing");
    await Promise.all([stepUpToAal2(admin), stepUpToAal2(betaAdmin)]);
    scheduler = await invite(
      admin.client,
      alphaId,
      "agency.scheduler",
      uniqueEmail("ops-scheduler"),
    );
    wendy = await invite(
      admin.client,
      alphaId,
      "agency.healthcare_worker",
      uniqueEmail("ops-wendy"),
    );
    walt = await invite(admin.client, alphaId, "agency.healthcare_worker", uniqueEmail("ops-walt"));
    w.wendy = await workerIdAt(wendy, alphaId);
    w.walt = await workerIdAt(walt, alphaId);
    await activateCna(admin.client, w.wendy);
    await activateCna(admin.client, w.walt);
    await run(
      admin.client.rpc("create_credential_requirement", {
        p_agency_organisation_id: alphaId,
        p_credential_type_key: "bls_certification",
      }),
    );
    const verifier = { client: admin.client, organisationId: alphaId };
    await blsEvidence(wendy, 400, [verifier]);
    await blsEvidence(walt, 400, [verifier]);
    mercy = await facilityWithRelationship(
      admin.client,
      alphaId,
      "Mercy Rehab",
      "America/New_York",
    );

    const operator = await signUpVerified("ops-operator");
    await grantPlatformAdmin(operator.userId);
    await stepUpToAal2(operator);
    const facilityEmail = uniqueEmail("ops-facility");
    const created = await must(
      operator.client.rpc("platform_create_organisation", {
        p_type: "facility",
        p_name: "Mercy Health Operations",
        p_slug: slug("mercy-ops"),
        p_owner_email: facilityEmail,
      }),
    );
    gammaId = created[0]?.organisation_id ?? "";
    facilityAdmin = await signUpVerified("ops-facility", facilityEmail);
    await run(
      facilityAdmin.client.rpc("accept_organisation_invite", {
        p_token: created[0]?.invite_token ?? "",
      }),
    );
    await run(
      operator.client.rpc("platform_link_agency_facility", {
        p_agency_facility_id: mercy.facilityId,
        p_facility_organisation_id: gammaId,
      }),
    );
  }, 180_000);

  afterAll(async () => {
    await store?.close();
  });

  let dayShift: string;
  let wendyAssignment: string;

  it("an assignment creates exactly one outbox event for the worker (identifiers only)", async () => {
    dayShift = await openShift(3, "07:00", "15:00", 2);
    const decision = await assign(scheduler.client, dayShift, w.wendy ?? "");
    wendyAssignment = decision.assignment_id ?? "";
    const rows = await outbox({ event: "worker_assigned", subjectId: wendyAssignment });
    expect(rows.map((row) => [row.recipient_profile_id, row.state])).toEqual([
      [wendy.userId, "pending"],
    ]);
  });

  it("the consumer delivers through a fake provider and records the provider id; claims are exclusive", async () => {
    const [row] = await outbox({ event: "worker_assigned", subjectId: wendyAssignment });
    await onlyDue([row?.id ?? ""]);
    // Two dispatchers race: SKIP LOCKED gives the row to exactly one.
    const second = createPostgresNotificationStore(WORKER_URL);
    const [a, b] = await Promise.all([store.claim(10, 60), second.claim(10, 60)]);
    await second.close();
    // Other test files share the outbox: assert on this row, and that no row went to both.
    const idsA = new Set(a.map((item) => item.notificationId));
    expect(b.some((item) => idsA.has(item.notificationId))).toBe(false);
    const mine = [...a, ...b].filter((item) => item.notificationId === row?.id);
    expect(mine).toHaveLength(1);
    const claimed = mine[0];
    expect(claimed?.recipientEmail).toBe(wendy.email);
    const state = await store.complete({
      notificationId: claimed?.notificationId ?? "",
      claimToken: claimed?.claimToken ?? "",
      outcome: "sent",
      provider: "fake",
      providerMessageId: "fake-123",
    });
    expect(state).toBe("sent");
    const [after] = await outbox({ event: "worker_assigned", subjectId: wendyAssignment });
    expect(after).toMatchObject({ state: "sent", provider_message_id: "fake-123", attempts: 1 });
  });

  it("a temporary provider failure retries; a permanent failure stops", async () => {
    await run(
      scheduler.client.rpc("cancel_shift_assignment", {
        p_assignment_id: wendyAssignment,
        p_reason: "other",
      }),
    );
    const [cancelled] = await outbox({ event: "assignment_cancelled", subjectId: wendyAssignment });
    await onlyDue([cancelled?.id ?? ""]);
    const flaky = fakeSender(() => ({
      status: "failed",
      provider: "fake",
      errorCode: "provider_unavailable",
    }));
    await dispatchNotifications({ store, sender: flaky, baseUrl: "http://localhost:3000" });
    expect(
      (await outbox({ event: "assignment_cancelled", subjectId: wendyAssignment }))[0],
    ).toMatchObject({
      state: "retry",
      last_error_code: "provider_unavailable",
    });

    await onlyDue([cancelled?.id ?? ""]);
    const rejecting = fakeSender(() => ({
      status: "failed",
      provider: "fake",
      errorCode: "provider_rejected",
    }));
    await dispatchNotifications({ store, sender: rejecting, baseUrl: "http://localhost:3000" });
    expect(
      (await outbox({ event: "assignment_cancelled", subjectId: wendyAssignment }))[0],
    ).toMatchObject({
      state: "failed",
      attempts: 2,
    });
    const problems = await must(
      scheduler.client.rpc("list_notification_deliveries", { p_organisation_id: alphaId }),
    );
    expect(problems.some((row) => row.last_error_code === "provider_rejected")).toBe(true);
    expect(JSON.stringify(problems)).not.toContain("@");
  });

  it("shift cancellation notifies the assigned worker", async () => {
    const shift = await openShift(4, "07:00", "15:00");
    const decision = await assign(scheduler.client, shift, w.walt ?? "");
    await run(
      scheduler.client.rpc("cancel_shift", {
        p_shift_id: shift,
        p_reason: "staffing_no_longer_needed",
      }),
    );
    const rows = await outbox({
      event: "shift_cancelled",
      subjectId: decision.assignment_id ?? "",
    });
    expect(rows.map((row) => row.recipient_profile_id)).toEqual([walt.userId]);
  });

  it("facility request events route to the right organisation's operational users", async () => {
    const options = await must(
      facilityAdmin.client.rpc("list_facility_request_options", {
        p_relationship_id: mercy.relationshipId,
      }),
    );
    const requestId = await must(
      facilityAdmin.client.rpc("submit_facility_shift_request", {
        p_relationship_id: mercy.relationshipId,
        p_facility_location_id: options[0]?.facility_location_id ?? "",
        p_discipline_key: "cna",
        p_shift_date: isoDay(9),
        p_start_time: "07:00",
        p_end_time: "15:00",
        p_requested_headcount: 1,
      }),
    );
    const submitted = await outbox({ event: "facility_request_submitted", subjectId: requestId });
    expect(submitted.map((row) => row.recipient_profile_id).sort()).toEqual(
      [admin.userId, scheduler.userId].sort(),
    );
    await run(scheduler.client.rpc("open_shift", { p_shift_id: requestId }));
    const opened = await outbox({ event: "facility_request_opened", subjectId: requestId });
    expect(opened.map((row) => row.recipient_profile_id)).toEqual([facilityAdmin.userId]);

    // Delivered to the facility with a facility route, through the real dispatcher.
    await onlyDue(opened.map((row) => row.id));
    const sender = fakeSender(() => ok);
    await dispatchNotifications({ store, sender, baseUrl: "http://localhost:3000" });
    expect(sender.sentTo).toContain(facilityAdmin.email);
    expect(
      (await outbox({ event: "facility_request_opened", subjectId: requestId }))[0]?.state,
    ).toBe("sent");
  });

  it("the readiness scan opens an issue once, notifies operations, and resolves when readiness returns", async () => {
    const shift = await openShift(5, "07:00", "15:00");
    const decision = await assign(scheduler.client, shift, w.walt ?? "");
    const shares = await must(
      walt.client.from("credential_shares").select("id").eq("status", "active"),
    );
    await run(walt.client.rpc("revoke_credential_share", { p_share_id: shares[0]?.id ?? "" }));

    const scan = () =>
      ownerQuery(
        (sql) => sql<{ result: { opened: number; resolved: number } }[]>`
        select internal.run_assignment_readiness_scan() as result`,
      );
    expect((await scan())[0]?.result.opened).toBeGreaterThanOrEqual(1);
    expect((await scan())[0]?.result.opened).toBe(0);
    const issues = await must(
      scheduler.client.rpc("list_assignment_issues", { p_organisation_id: alphaId }),
    );
    const mine = issues.filter((issue) => issue.assignment_id === decision.assignment_id);
    expect(mine.map((issue) => issue.issue_type)).toEqual(["not_eligible"]);
    expect(mine[0]?.compliance_reasons).toEqual(["CREDENTIAL_NOT_SHARED"]);
    const alerts = await outbox({
      event: "assignment_non_compliant",
      subjectId: decision.assignment_id ?? "",
    });
    expect(alerts).toHaveLength(2);

    const credentials = await must(walt.client.from("credentials").select("id"));
    await run(
      walt.client.rpc("share_credential", {
        p_credential_id: credentials[0]?.id ?? "",
        p_agency_organisation_id: alphaId,
      }),
    );
    expect((await scan())[0]?.result.resolved).toBeGreaterThanOrEqual(1);
    const after = await must(
      scheduler.client.rpc("list_assignment_issues", { p_organisation_id: alphaId }),
    );
    expect(after.some((issue) => issue.assignment_id === decision.assignment_id)).toBe(false);
  });

  it("offers: two workers race for the last slot → exactly one assignment; the other offer closes", async () => {
    const shift = await openShift(6, "07:00", "15:00", 1);
    const offered = await must(
      scheduler.client.rpc("offer_shift_to_workers", {
        p_shift_id: shift,
        p_agency_worker_ids: [w.wendy ?? "", w.walt ?? ""],
      }),
    );
    expect(offered.map((row) => row.outcome)).toEqual(["offered", "offered"]);
    const [wendyOffers, waltOffers] = await Promise.all([
      must(wendy.client.rpc("list_my_shift_offers", { p_organisation_id: alphaId })),
      must(walt.client.rpc("list_my_shift_offers", { p_organisation_id: alphaId })),
    ]);
    const results = await Promise.all([
      wendy.client.rpc("accept_shift_offer", { p_offer_id: wendyOffers[0]?.offer_id ?? "" }),
      walt.client.rpc("accept_shift_offer", { p_offer_id: waltOffers[0]?.offer_id ?? "" }),
    ]);
    const outcomes = results.map((result) => result.data?.[0]?.outcome ?? result.error?.code);
    expect(outcomes.filter((outcome) => outcome === "allowed")).toHaveLength(1);
    const active = await must(
      scheduler.client
        .from("shift_assignments")
        .select("id")
        .eq("shift_id", shift)
        .in("status", ["assigned", "accepted"]),
    );
    expect(active).toHaveLength(1);
    const offers = await must(
      scheduler.client.from("shift_offers").select("status, close_reason").eq("shift_id", shift),
    );
    expect(offers.map((offer) => offer.status).sort()).toEqual(["accepted", "cancelled"]);
    // The facility never sees offer activity.
    const facilityView = await facilityAdmin.client.from("shift_offers").select("id");
    expect(facilityView.data).toEqual([]);
  });

  it("a worker declines an offer; an expired offer is refused", async () => {
    const shift = await openShift(8, "07:00", "15:00", 2);
    await must(
      scheduler.client.rpc("offer_shift_to_workers", {
        p_shift_id: shift,
        p_agency_worker_ids: [w.wendy ?? ""],
      }),
    );
    const mine = await must(
      wendy.client.rpc("list_my_shift_offers", { p_organisation_id: alphaId }),
    );
    const offer = mine.find((row) => row.status === "offered");
    await run(wendy.client.rpc("decline_shift_offer", { p_offer_id: offer?.offer_id ?? "" }));
    const again = await wendy.client.rpc("accept_shift_offer", {
      p_offer_id: offer?.offer_id ?? "",
    });
    expect(again.error?.code).toBe("CHO09");

    const [expired] = await ownerQuery(
      (sql) => sql<{ id: string }[]>`
        insert into public.shift_offers
          (shift_id, agency_organisation_id, agency_worker_id, profile_id, offered_at, expires_at, created_by_membership_id)
        select ${shift}::uuid, ${alphaId}::uuid, ${w.walt ?? ""}::uuid, ${walt.userId}::uuid,
               now() - interval '2 hours', now() - interval '1 hour', m.id
        from public.organisation_memberships m
        where m.organisation_id = ${alphaId}::uuid and m.profile_id = ${scheduler.userId}::uuid
        returning id`,
    );
    const late = await walt.client.rpc("accept_shift_offer", { p_offer_id: expired?.id ?? "" });
    expect(late.error?.code).toBe("CHO10");
  });

  it("suspending the relationship blocks new work and flags upcoming assignments", async () => {
    const shift = await openShift(10, "07:00", "15:00", 2);
    const decision = await assign(scheduler.client, shift, w.wendy ?? "");
    await run(
      admin.client.rpc("set_facility_relationship_status", {
        p_relationship_id: mercy.relationshipId,
        p_status: "suspended",
      }),
    );
    const blocked = await scheduler.client.rpc("assign_worker_to_shift", {
      p_shift_id: shift,
      p_agency_worker_id: w.walt ?? "",
    });
    expect(blocked.error?.code).toBe("CHS10");
    const issues = await must(
      scheduler.client.rpc("list_assignment_issues", { p_organisation_id: alphaId }),
    );
    expect(
      issues.some(
        (issue) =>
          issue.assignment_id === decision.assignment_id &&
          issue.issue_type === "relationship_not_active",
      ),
    ).toBe(true);
    const affected = await must(
      scheduler.client.rpc("list_relationship_affected_shifts", { p_organisation_id: alphaId }),
    );
    expect(affected.some((row) => row.shift_id === shift)).toBe(true);

    await run(
      admin.client.rpc("set_facility_relationship_status", {
        p_relationship_id: mercy.relationshipId,
        p_status: "active",
      }),
    );
    const restored = await must(
      scheduler.client.rpc("list_assignment_issues", { p_organisation_id: alphaId }),
    );
    expect(restored.some((issue) => issue.issue_type === "relationship_not_active")).toBe(false);
  });

  it("another agency cannot read offers, issues or delivery status", async () => {
    const offers = await betaAdmin.client.from("shift_offers").select("id");
    expect(offers.data).toEqual([]);
    const issues = await betaAdmin.client.rpc("list_assignment_issues", {
      p_organisation_id: alphaId,
    });
    expect(issues.error?.code).toBe("CH403");
    const deliveries = await betaAdmin.client.rpc("list_notification_deliveries", {
      p_organisation_id: alphaId,
    });
    expect(deliveries.error?.code).toBe("CH403");
  });

  it("the TypeScript notification vocabulary matches the database enum", async () => {
    const [row] = await ownerQuery(
      (sql) =>
        sql<
          { values: string[] }[]
        >`select enum_range(null::internal.notification_event)::text[] as values`,
    );
    expect(row?.values).toEqual([...NOTIFICATION_EVENTS]);
  });
});
