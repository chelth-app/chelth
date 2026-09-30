import { describe, expect, it } from "vitest";

import { buildSecurityHeaders, PERMISSIONS_POLICY } from "@/lib/security/security-headers";

describe("buildSecurityHeaders", () => {
  const headers = Object.fromEntries(
    buildSecurityHeaders({ isDevelopment: false }).map(({ key, value }) => [key, value]),
  );

  it("sets the baseline headers", () => {
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
  });

  it("keeps geolocation available to our origin for the future worker PWA", () => {
    expect(PERMISSIONS_POLICY).toContain("geolocation=(self)");
    expect(PERMISSIONS_POLICY).toContain("camera=()");
  });

  it("omits HSTS in development", () => {
    const dev = buildSecurityHeaders({ isDevelopment: true }).map(({ key }) => key);
    expect(dev).not.toContain("Strict-Transport-Security");
  });
});
