/**
 * Server-only environment schema.
 *
 * Separate from env.schema.ts so that server variable NAMES never reach a
 * browser bundle (env.public.ts → env.schema.ts is client-reachable).
 * Imported only by env.server.ts, next.config.ts and tests.
 */
import { z } from "zod";

import { EnvValidationError, formatIssues } from "./env.schema";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Server-only variables. Add future secrets here (e.g. SENTRY_DSN, email
 * provider keys). A Supabase service-role key is deliberately NOT defined:
 * privileged database access requires an approved, reviewed design first
 * (see docs/security/SECURITY_INVARIANTS.md, invariant 2).
 */
export const EMAIL_PROVIDERS = ["disabled", "resend"] as const;
export type EmailProviderName = (typeof EMAIL_PROVIDERS)[number];

/** "Name <address@domain>" or a bare address. */
const emailFromSchema = z
  .string()
  .trim()
  .regex(
    /^(?:[^<>\r\n]{1,100} <)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/,
    "EMAIL_FROM must be an address or 'Name <address>'",
  );

export const serverEnvSchema = z
  .object({
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
    SENTRY_DSN: z.url().optional(),
    // Transactional email. "disabled" (default) never sends: invitation links
    // are shown once to the issuer instead. See docs/architecture/TRANSACTIONAL_EMAIL.md.
    EMAIL_PROVIDER: z.enum(EMAIL_PROVIDERS).default("disabled"),
    RESEND_API_KEY: z.string().trim().min(20, "RESEND_API_KEY looks truncated").optional(),
    EMAIL_FROM: emailFromSchema.optional(),
    // Notification delivery (docs/architecture/NOTIFICATION_DELIVERY.md). All
    // optional: without them the dispatch route reports "not configured".
    /** Canonical application origin for links in background emails (no request origin exists). */
    APP_BASE_URL: z
      .url({ protocol: /^https?$/ })
      .transform((value) => value.replace(/\/+$/, ""))
      .optional(),
    /** Bearer secret the scheduler presents to the dispatch route. */
    NOTIFICATION_DISPATCH_SECRET: z
      .string()
      .trim()
      .min(32, "NOTIFICATION_DISPATCH_SECRET must be at least 32 characters")
      .optional(),
    /** Connection for a LOGIN role in chelth_notification_worker (claim/complete only). */
    NOTIFICATION_WORKER_DATABASE_URL: z
      .string()
      .trim()
      .regex(/^postgres(ql)?:\/\//, "NOTIFICATION_WORKER_DATABASE_URL must be a postgres:// URL")
      .optional(),
  })
  .superRefine((env, ctx) => {
    if (env.APP_BASE_URL && env.NOTIFICATION_WORKER_DATABASE_URL) {
      const host = new URL(env.APP_BASE_URL).hostname;
      const local = host === "localhost" || host === "127.0.0.1";
      if (!local && !env.APP_BASE_URL.startsWith("https://")) {
        ctx.addIssue({
          code: "custom",
          path: ["APP_BASE_URL"],
          message: "APP_BASE_URL must use https outside local development.",
        });
      }
    }
    if (env.EMAIL_PROVIDER !== "resend") return;
    if (!env.RESEND_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "Required when EMAIL_PROVIDER=resend.",
      });
    }
    if (!env.EMAIL_FROM) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_FROM"],
        message: "Required when EMAIL_PROVIDER=resend.",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) throw new EnvValidationError("server", formatIssues(result.error));
  return result.data;
}
