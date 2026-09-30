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
  })
  .superRefine((env, ctx) => {
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
