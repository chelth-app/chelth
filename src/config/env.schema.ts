/**
 * Environment variable schemas.
 *
 * This module is intentionally pure: no `process.env` reads, no side effects.
 * It is imported by `next.config.ts` (build-time validation), by the runtime
 * accessors in `env.public.ts` / `env.server.ts`, and by unit tests.
 *
 * Rules:
 * - Public (browser-visible) variables MUST be prefixed `NEXT_PUBLIC_` and are
 *   inlined into client bundles at build time. Never put a secret here.
 * - Server-only variables are defined in `serverEnvSchema` and may only be read
 *   through `env.server.ts`, which is guarded by `server-only`.
 * - There is no demo / offline / localStorage fallback. Missing configuration
 *   is a hard failure.
 */
import { z } from "zod";

export const APP_ENVIRONMENTS = ["development", "test", "preview", "production"] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export const appEnvironmentSchema = z.enum(APP_ENVIRONMENTS);

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

/**
 * Decodes the payload segment of a JWT without verifying it. Used only to
 * detect a misplaced privileged key; never used for authentication.
 */
function decodeJwtPayload(token: string): unknown {
  const segments = token.split(".");
  const payload = segments[1];
  if (segments.length !== 3 || payload === undefined) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    return JSON.parse(atob(padded)) as unknown;
  } catch {
    return null;
  }
}

/**
 * Returns true when a key is recognisably a privileged Supabase key
 * (new-style `sb_secret_…` key, or a legacy JWT whose role is `service_role`).
 * Such a key must never be configured as a public variable.
 */
export function isPrivilegedSupabaseKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const payload = decodeJwtPayload(key);
  return (
    typeof payload === "object" &&
    payload !== null &&
    "role" in payload &&
    (payload as { role: unknown }).role === "service_role"
  );
}

export const publicEnvSchema = z
  .object({
    NEXT_PUBLIC_APP_ENV: appEnvironmentSchema,
    NEXT_PUBLIC_SUPABASE_URL: z.url({ protocol: /^https?$/ }),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z
      .string()
      .trim()
      .min(20, "NEXT_PUBLIC_SUPABASE_ANON_KEY looks truncated")
      .refine((key) => !isPrivilegedSupabaseKey(key), {
        message:
          "NEXT_PUBLIC_SUPABASE_ANON_KEY contains a privileged (service-role/secret) key. " +
          "Only the anon/publishable key may be exposed to the browser.",
      }),
  })
  .superRefine((env, ctx) => {
    if (env.NEXT_PUBLIC_APP_ENV !== "production") return;
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
    if (url.protocol !== "https:") {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_SUPABASE_URL"],
        message: "Production requires an https Supabase URL.",
      });
    }
    if (LOCAL_HOSTNAMES.has(url.hostname)) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_SUPABASE_URL"],
        message: "Production must not point at a local Supabase instance.",
      });
    }
  });

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Server-only variables. Add future secrets here (e.g. SENTRY_DSN, email
 * provider keys). A Supabase service-role key is deliberately NOT defined:
 * privileged database access requires an approved, reviewed design first
 * (see docs/security/SECURITY_INVARIANTS.md, invariant 2).
 */
export const serverEnvSchema = z.object({
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  SENTRY_DSN: z.url().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvValidationError extends Error {
  override readonly name = "EnvValidationError";
  readonly issues: readonly string[];

  constructor(scope: "public" | "server", issues: readonly string[]) {
    super(
      `Invalid ${scope} environment configuration:\n` +
        issues.map((issue) => `  - ${issue}`).join("\n") +
        "\nSee .env.example and README.md#environment-setup.",
    );
    this.issues = issues;
  }
}

function formatIssues(error: z.ZodError): string[] {
  // Issue messages never include the offending value, so secrets are not echoed.
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const result = publicEnvSchema.safeParse(source);
  if (!result.success) throw new EnvValidationError("public", formatIssues(result.error));
  return result.data;
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) throw new EnvValidationError("server", formatIssues(result.error));
  return result.data;
}

/**
 * Resolves the application environment. An explicit NEXT_PUBLIC_APP_ENV wins;
 * otherwise Vercel's VERCEL_ENV is mapped; otherwise a production NODE_ENV
 * resolves to "production" (fail closed: the strictest rules apply).
 */
export function resolveAppEnvironment(source: {
  NEXT_PUBLIC_APP_ENV?: string | undefined;
  VERCEL_ENV?: string | undefined;
  NODE_ENV?: string | undefined;
}): AppEnvironment {
  if (source.NEXT_PUBLIC_APP_ENV) {
    return appEnvironmentSchema.parse(source.NEXT_PUBLIC_APP_ENV);
  }
  switch (source.VERCEL_ENV) {
    case "production":
      return "production";
    case "preview":
      return "preview";
    case "development":
      return "development";
    default:
      break;
  }
  if (source.NODE_ENV === "test") return "test";
  if (source.NODE_ENV === "development") return "development";
  return "production";
}
