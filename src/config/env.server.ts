/**
 * Validated server-only environment.
 *
 * `server-only` makes any import of this module from a Client Component a
 * build error, so secrets defined here cannot reach browser bundles.
 */
import "server-only";

import { parseServerEnv, type ServerEnv } from "./env.server.schema";

export const serverEnv: ServerEnv = parseServerEnv({
  LOG_LEVEL: process.env.LOG_LEVEL,
  SENTRY_DSN: process.env.SENTRY_DSN,
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
  APP_BASE_URL: process.env.APP_BASE_URL,
  NOTIFICATION_DISPATCH_SECRET: process.env.NOTIFICATION_DISPATCH_SECRET,
  NOTIFICATION_WORKER_DATABASE_URL: process.env.NOTIFICATION_WORKER_DATABASE_URL,
});
