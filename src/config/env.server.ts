/**
 * Validated server-only environment.
 *
 * `server-only` makes any import of this module from a Client Component a
 * build error, so secrets defined here cannot reach browser bundles.
 */
import "server-only";

import { parseServerEnv, type ServerEnv } from "./env.schema";

export const serverEnv: ServerEnv = parseServerEnv({
  LOG_LEVEL: process.env.LOG_LEVEL,
  SENTRY_DSN: process.env.SENTRY_DSN,
});
