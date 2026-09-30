/**
 * Content-Security-Policy builder.
 *
 * Chelth uses a per-request nonce with 'strict-dynamic' so that no
 * `'unsafe-inline'` is needed for scripts. The nonce is generated in
 * `src/proxy.ts`; Next.js reads it from the request CSP header and applies it
 * to framework scripts automatically. See docs/security/SECURITY_INVARIANTS.md
 * and docs/architecture/TECHNICAL_ARCHITECTURE.md#content-security-policy.
 *
 * Documented relaxations:
 * - Development only: 'unsafe-eval' (React dev tooling reconstructs stacks
 *   with eval), ws: for hot reload, and style-src 'unsafe-inline' because the
 *   Next.js dev overlay injects un-nonced <style> elements. (Browsers ignore
 *   'unsafe-inline' when a nonce is present, so dev omits the style nonce.)
 *   None of these are ever emitted outside development; production builds are
 *   verified violation-free by tests/e2e/foundation.spec.ts.
 */

export type CspOptions = {
  nonce: string;
  supabaseUrl: string;
  isDevelopment: boolean;
};

function toWebSocketOrigin(origin: string): string {
  return origin.replace(/^http/, "ws");
}

export function buildContentSecurityPolicy({
  nonce,
  supabaseUrl,
  isDevelopment,
}: CspOptions): string {
  const supabaseOrigin = new URL(supabaseUrl).origin;

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDevelopment ? ["'unsafe-eval'"] : []),
    ],
    "style-src": isDevelopment ? ["'self'", "'unsafe-inline'"] : ["'self'", `'nonce-${nonce}'`],
    "img-src": ["'self'", "blob:", "data:", supabaseOrigin],
    "font-src": ["'self'"],
    "connect-src": [
      "'self'",
      supabaseOrigin,
      toWebSocketOrigin(supabaseOrigin),
      ...(isDevelopment ? ["ws:"] : []),
    ],
    "media-src": ["'self'"],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
  };

  const policy = Object.entries(directives).map(
    ([directive, sources]) => `${directive} ${sources.join(" ")}`,
  );
  if (!isDevelopment) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}
