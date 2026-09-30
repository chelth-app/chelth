/**
 * Static security headers applied to every response via `next.config.ts`.
 * The Content-Security-Policy is per-request (nonce) and set in `src/proxy.ts`.
 *
 * Deliberate choices (see docs/security/SECURITY_INVARIANTS.md):
 * - HSTS omits `includeSubDomains` and `preload` until the production domain
 *   topology is confirmed; both are hard to reverse.
 * - Permissions-Policy keeps geolocation available to our own origin because
 *   the future worker PWA needs it for clock-in verification. Everything else
 *   not yet needed is disabled.
 */
export type SecurityHeader = { key: string; value: string };

export const PERMISSIONS_POLICY = [
  "geolocation=(self)",
  "camera=()",
  "microphone=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "bluetooth=()",
  "hid=()",
  "midi=()",
  "display-capture=()",
  "browsing-topics=()",
  "interest-cohort=()",
].join(", ");

export function buildSecurityHeaders({
  isDevelopment,
}: {
  isDevelopment: boolean;
}): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
  ];
  if (!isDevelopment) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000" });
  }
  return headers;
}
