import "server-only";

import postgres from "postgres";

import type { ClaimedNotification, NotificationStore } from "./dispatcher";

/**
 * Store backed by internal.claim_notifications / internal.complete_notification,
 * reached through a LOGIN role that is a member of chelth_notification_worker
 * (EXECUTE on those two functions only). No service-role key is involved.
 */
export function createPostgresNotificationStore(
  connectionString: string,
): NotificationStore & { close(): Promise<void> } {
  // prepare: false — compatible with transaction-mode connection poolers.
  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    idle_timeout: 5,
    connect_timeout: 10,
  });
  return {
    async claim(limit, leaseSeconds) {
      const rows = await sql<
        {
          notification_id: string;
          event: string;
          attempt: number;
          claim_token: string;
          recipient_email: string;
          template: unknown;
        }[]
      >`select * from internal.claim_notifications(${limit}::integer, ${leaseSeconds}::integer)`;
      return rows.map((row): ClaimedNotification => ({
        notificationId: row.notification_id,
        event: row.event,
        attempt: row.attempt,
        claimToken: row.claim_token,
        recipientEmail: row.recipient_email,
        template: row.template,
      }));
    },
    async complete(input) {
      const rows = await sql<{ state: string }[]>`
        select internal.complete_notification(
          ${input.notificationId}::uuid, ${input.claimToken}::uuid, ${input.outcome}, ${input.provider},
          ${input.providerMessageId ?? null}, ${input.errorCode ?? null}) as state`;
      return rows[0]?.state ?? "stale_claim";
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
