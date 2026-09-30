import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy } from "@/lib/security/csp";
import { generateNonce } from "@/lib/security/nonce";

function directive(policy: string, name: string): string {
  return policy.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";
}

const base = { nonce: "abc123", supabaseUrl: "https://project.supabase.co" };

describe("buildContentSecurityPolicy (production)", () => {
  const policy = buildContentSecurityPolicy({ ...base, isDevelopment: false });

  it("uses a nonce with strict-dynamic and never unsafe-inline/unsafe-eval for scripts", () => {
    const scriptSrc = directive(policy, "script-src");
    expect(scriptSrc).toContain("'nonce-abc123'");
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
  });

  it("does not allow un-nonced inline styles", () => {
    expect(directive(policy, "style-src")).toBe("style-src 'self' 'nonce-abc123'");
  });

  it("blocks framing, plugins and base-uri hijacking", () => {
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(directive(policy, "base-uri")).toBe("base-uri 'self'");
    expect(directive(policy, "form-action")).toBe("form-action 'self'");
  });

  it("allows only the configured Supabase origin for connections", () => {
    const connectSrc = directive(policy, "connect-src");
    expect(connectSrc).toContain("https://project.supabase.co");
    expect(connectSrc).toContain("wss://project.supabase.co");
    expect(connectSrc).not.toMatch(/\s\*(\s|$)/);
  });

  it("upgrades insecure requests", () => {
    expect(policy).toContain("upgrade-insecure-requests");
  });
});

describe("buildContentSecurityPolicy (development)", () => {
  it("adds only the documented dev relaxations", () => {
    const policy = buildContentSecurityPolicy({ ...base, isDevelopment: true });
    expect(directive(policy, "script-src")).toContain("'unsafe-eval'");
    expect(directive(policy, "script-src")).not.toContain("unsafe-inline");
    expect(directive(policy, "style-src")).toBe("style-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });
});

describe("generateNonce", () => {
  it("produces unique base64 values with 128 bits of entropy", () => {
    const nonces = new Set(Array.from({ length: 50 }, generateNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    }
  });
});
