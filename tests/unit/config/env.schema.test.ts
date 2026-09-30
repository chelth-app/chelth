import { describe, expect, it } from "vitest";

import {
  EnvValidationError,
  isPrivilegedSupabaseKey,
  parsePublicEnv,
  resolveAppEnvironment,
} from "@/config/env.schema";
import { parseServerEnv } from "@/config/env.server.schema";

function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature-not-checked`;
}

// Synthetic fixtures are assembled at runtime so secret scanners do not flag them.
const SECRET_PREFIX = ["sb", "secret", ""].join("_");

const validLocal = {
  NEXT_PUBLIC_APP_ENV: "development",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt({ role: "anon" }),
};

describe("parsePublicEnv", () => {
  it("accepts a valid local configuration", () => {
    expect(parsePublicEnv(validLocal).NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:55321");
  });

  it("fails when required variables are missing (no fallback mode)", () => {
    expect(() => parsePublicEnv({})).toThrow(EnvValidationError);
    try {
      parsePublicEnv({});
    } catch (error) {
      const issues = (error as EnvValidationError).issues.join("\n");
      expect(issues).toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect(issues).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
      expect(issues).toContain("NEXT_PUBLIC_APP_ENV");
    }
  });

  it("rejects a service-role JWT in the public anon key variable", () => {
    expect(() =>
      parsePublicEnv({
        ...validLocal,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt({ role: "service_role" }),
      }),
    ).toThrow(/privileged/);
  });

  it("rejects an sb_secret_ key in the public anon key variable", () => {
    expect(() =>
      parsePublicEnv({
        ...validLocal,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: `${SECRET_PREFIX}abcdefghijklmnopqrstuvwxyz`,
      }),
    ).toThrow(/privileged/);
  });

  it("never echoes the offending value in the error message", () => {
    const secret = `${SECRET_PREFIX}do-not-print-me-0123456789`;
    try {
      parsePublicEnv({ ...validLocal, NEXT_PUBLIC_SUPABASE_ANON_KEY: secret });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it("requires https and a non-local host in production", () => {
    expect(() => parsePublicEnv({ ...validLocal, NEXT_PUBLIC_APP_ENV: "production" })).toThrow(
      /https[\s\S]*local/,
    );
    expect(
      parsePublicEnv({
        ...validLocal,
        NEXT_PUBLIC_APP_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.co",
      }).NEXT_PUBLIC_APP_ENV,
    ).toBe("production");
  });

  it("rejects non-http(s) URLs", () => {
    expect(() =>
      parsePublicEnv({ ...validLocal, NEXT_PUBLIC_SUPABASE_URL: "javascript:alert(1)" }),
    ).toThrow(EnvValidationError);
  });
});

describe("isPrivilegedSupabaseKey", () => {
  it("allows anon JWTs and publishable keys", () => {
    expect(isPrivilegedSupabaseKey(fakeJwt({ role: "anon" }))).toBe(false);
    expect(isPrivilegedSupabaseKey("sb_publishable_abc123")).toBe(false);
    expect(isPrivilegedSupabaseKey("not-a-jwt")).toBe(false);
  });
});

describe("parseServerEnv", () => {
  it("applies defaults and validates enums", () => {
    expect(parseServerEnv({}).LOG_LEVEL).toBe("info");
    expect(() => parseServerEnv({ LOG_LEVEL: "verbose" })).toThrow(EnvValidationError);
  });
});

describe("resolveAppEnvironment", () => {
  it("prefers an explicit NEXT_PUBLIC_APP_ENV", () => {
    expect(resolveAppEnvironment({ NEXT_PUBLIC_APP_ENV: "test", VERCEL_ENV: "production" })).toBe(
      "test",
    );
  });

  it("maps VERCEL_ENV", () => {
    expect(resolveAppEnvironment({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(
      "preview",
    );
  });

  it("fails closed to production for an unlabelled production build", () => {
    expect(resolveAppEnvironment({ NODE_ENV: "production" })).toBe("production");
    expect(resolveAppEnvironment({})).toBe("production");
  });

  it("rejects unknown explicit values", () => {
    expect(() => resolveAppEnvironment({ NEXT_PUBLIC_APP_ENV: "demo" })).toThrow();
  });
});
