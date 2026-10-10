import { beforeAll, describe, expect, it } from "vitest";

import { notificationTemplateSchema, renderNotification } from "@/lib/notifications";

import { ownerQuery, signUpVerified, stepUpToAal2, type TestIdentity } from "./support/identities";
import { activateCna, createAgency, invite, must, workerIdAt } from "./support/staffing";

/*
 * P0-E9-3D-S3 operational messaging through the real API (RLS + RPCs):
 * a worker ↔ agency thread with idempotent sends, unread state, sender
 * labels, deny-by-default for other workers and agencies, and the worker's
 * e-mail notification that never contains the message body.
 */
const BODY = "Please report through the east entrance — badge desk on level 2.";

describe("operational messaging (P0-E9-3D-S3)", () => {
  let admin: TestIdentity;
  let otherAdmin: TestIdentity;
  let scheduler: TestIdentity;
  let worker: TestIdentity;
  let stranger: TestIdentity;
  let agencyId: string;
  let otherAgencyId: string;
  let workerId: string;
  let threadId: string;

  beforeAll(async () => {
    admin = await signUpVerified("msg-admin");
    otherAdmin = await signUpVerified("msg-other-admin");
    agencyId = await createAgency(admin, "Message Agency");
    otherAgencyId = await createAgency(otherAdmin, "Other Message Agency");
    await stepUpToAal2(admin);
    await stepUpToAal2(otherAdmin);
    scheduler = await invite(
      admin.client,
      agencyId,
      "agency.scheduler",
      "msg-scheduler@example.test".replace("@", `+${Date.now()}@`),
    );
    worker = await invite(
      admin.client,
      agencyId,
      "agency.healthcare_worker",
      `msg-worker+${Date.now()}@example.test`,
    );
    stranger = await invite(
      admin.client,
      agencyId,
      "agency.healthcare_worker",
      `msg-stranger+${Date.now()}@example.test`,
    );
    workerId = await workerIdAt(worker, agencyId);
    await activateCna(admin.client, workerId);
    await activateCna(admin.client, await workerIdAt(stranger, agencyId));
  });

  it("a worker opens their thread, sends once per key, and the agency replies", async () => {
    threadId = await must(
      worker.client.rpc("open_worker_thread", { p_agency_worker_id: workerId }),
    );
    const key = crypto.randomUUID();
    const first = await must(
      worker.client.rpc("send_message", {
        p_thread_id: threadId,
        p_body: "Hello, quick question",
        p_client_key: key,
      }),
    );
    const retry = await must(
      worker.client.rpc("send_message", {
        p_thread_id: threadId,
        p_body: "Hello, quick question",
        p_client_key: key,
      }),
    );
    expect(first[0]?.duplicate).toBe(false);
    expect(retry[0]?.duplicate).toBe(true);
    expect(retry[0]?.message_id).toBe(first[0]?.message_id);

    await must(
      scheduler.client.rpc("send_message", {
        p_thread_id: threadId,
        p_body: BODY,
        p_client_key: crypto.randomUUID(),
      }),
    );
    const unread = await must(
      worker.client.rpc("unread_message_count", { p_organisation_id: agencyId }),
    );
    expect(unread).toBe(1);
    const messages = await must(
      worker.client.rpc("list_thread_messages", { p_thread_id: threadId }),
    );
    expect(messages.map((row) => row.sender_label).sort()).toEqual(["Message Agency", "You"]);
    const read = await worker.client.rpc("mark_thread_read", { p_thread_id: threadId });
    expect(read.error).toBeNull();
    expect(
      await must(worker.client.rpc("unread_message_count", { p_organisation_id: agencyId })),
    ).toBe(0);
  });

  it("denies other workers and other agencies by default", async () => {
    const asStranger = await stranger.client
      .from("messages")
      .select("id")
      .eq("thread_id", threadId);
    expect(asStranger.data).toEqual([]);
    const strangerSend = await stranger.client.rpc("send_message", {
      p_thread_id: threadId,
      p_body: "hi",
      p_client_key: crypto.randomUUID(),
    });
    expect(strangerSend.error?.code).toBe("CH403");
    const otherAgency = await must(
      otherAdmin.client.rpc("list_my_threads", { p_organisation_id: agencyId }),
    );
    expect(otherAgency).toEqual([]);
    const ownList = await must(
      otherAdmin.client.rpc("list_my_threads", { p_organisation_id: otherAgencyId }),
    );
    expect(ownList).toEqual([]);
    const forged = await worker.client.from("messages").insert({
      thread_id: threadId,
      agency_organisation_id: agencyId,
      sender_profile_id: worker.userId,
      sender_side: "agency",
      body: "forged",
      client_key: crypto.randomUUID(),
    });
    expect(forged.error).not.toBeNull();
  });

  it("notifies the worker by e-mail without the message body, linking to the thread", async () => {
    const [notice] = await ownerQuery(
      (sql) => sql<{ id: string }[]>`
        select id from internal.notification_outbox
        where event = 'message_received' and subject_id = ${threadId}::uuid
          and recipient_profile_id = ${worker.userId}::uuid`,
    );
    expect(notice).toBeDefined();
    const [row] = await ownerQuery(
      (sql) =>
        sql<
          { data: unknown }[]
        >`select internal.notification_template(${notice?.id ?? ""}::uuid) as data`,
    );
    const data = notificationTemplateSchema.parse(row?.data);
    expect(data.path).toBe(`/app/organisations/${agencyId}/messages/${threadId}`);
    const rendered = renderNotification(data, "https://app.chelth.example");
    expect(rendered.subject).toBe("You have a new Chelth message regarding your shift");
    for (const part of [rendered.subject, rendered.text, rendered.html]) {
      expect(part).not.toContain("east entrance");
      expect(part).not.toContain("badge desk");
    }
    expect(rendered.text).toContain(`/app/organisations/${agencyId}/messages/${threadId}`);
  });
});
