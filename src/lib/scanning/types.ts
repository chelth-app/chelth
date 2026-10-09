/**
 * Provider-neutral malware scanning model (P0-E9-2).
 *
 * Domain code never sees a vendor response: every adapter normalises its
 * provider's output to a ScanVerdict. Anything that is not a definite
 * verdict is a `transient_failure` — fail-closed, never clean.
 */
export type ScanVerdict =
  | { result: "clean" }
  | { result: "malicious" }
  /** Definitively cannot be scanned (corrupt, encrypted, wrong format). */
  | { result: "unscannable" }
  | { result: "transient_failure"; errorCode: ScanErrorCode };

/** Safe, fixed error codes (stored and logged; never provider text). */
export type ScanErrorCode =
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_rate_limited"
  | "provider_auth"
  | "provider_error"
  | "provider_malformed"
  | "object_unavailable";

export type MalwareScanner = {
  /** Lower-case engine label recorded with each result, e.g. "cloudmersive". */
  readonly engine: string;
  /** Must never throw; every failure is a transient_failure verdict. */
  scan(input: { bytes: Uint8Array; mimeType: string }): Promise<ScanVerdict>;
};
