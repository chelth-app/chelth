/**
 * Notification dispatch (P0-E5-S2). Server-to-server only: called by the
 * database scheduler (pg_cron → pg_net) or an operator, never by browsers.
 *
 * - Authenticated by a bearer secret (constant-time comparison).
 * - Uses a least-privilege database role (claim/complete only).
 * - Responds with counts only; never addresses, subjects or errors' text.
 */
import { serverEnv } from "@/config/env.server";
import { getEmailSender } from "@/lib/email";
import { logger } from "@/lib/logging";
import { dispatchNotifications } from "@/lib/notifications";
import { isAuthorizedDispatch } from "@/lib/notifications/dispatch-auth";
import { createPostgresNotificationStore } from "@/lib/notifications/postgres-store";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const secret = serverEnv.NOTIFICATION_DISPATCH_SECRET;
  const databaseUrl = serverEnv.NOTIFICATION_WORKER_DATABASE_URL;
  const baseUrl = serverEnv.APP_BASE_URL;
  if (!secret || !databaseUrl || !baseUrl) {
    return Response.json({ status: "not_configured" }, { status: 503, headers: NO_STORE });
  }
  if (!isAuthorizedDispatch(request.headers.get("authorization"), secret)) {
    return Response.json({ status: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const store = createPostgresNotificationStore(databaseUrl);
  try {
    const result = await dispatchNotifications({
      store,
      sender: getEmailSender(),
      baseUrl,
      logger: {
        info: (message, context) => logger.info(message, context),
        warn: (message, context) => logger.warn(message, context),
      },
    });
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    logger.error("Notification dispatch failed", { error });
    return Response.json({ status: "error" }, { status: 500, headers: NO_STORE });
  } finally {
    await store.close();
  }
}
