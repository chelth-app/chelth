/**
 * Returns `candidate` only if it is a same-origin relative path; otherwise
 * `fallback`. Prevents open redirects via `?next=` style parameters.
 */
export function getSafeRedirectPath(candidate: string | null | undefined, fallback = "/"): string {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 2048) {
    return fallback;
  }
  // Must be an absolute path on this origin: "/x", not "//host", "/\host" or "https://…".
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.startsWith("/\\")) {
    return fallback;
  }
  // Reject control characters and backslashes, which browsers may normalise into "//".
  if (/[\u0000-\u001f\u007f\\]/.test(candidate)) return fallback;

  try {
    const base = "https://chelth.invalid";
    const resolved = new URL(candidate, base);
    if (resolved.origin !== base) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
