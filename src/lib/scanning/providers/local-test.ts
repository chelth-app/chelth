import type { MalwareScanner } from "../types";

/**
 * LOCAL / TEST ONLY deterministic scanner (refused in production by the
 * provider factory). It exercises every pipeline path without a vendor:
 *
 *   EICAR test signature anywhere          → malicious
 *   "CHELTH-SCAN-TRANSIENT" marker          → transient_failure (provider_unavailable)
 *   a PDF without an end-of-file marker     → unscannable (corrupt)
 *   anything else                           → clean
 *
 * EICAR is the industry-standard harmless test string, not malware.
 */
export const EICAR_SIGNATURE =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
export const TRANSIENT_MARKER = "CHELTH-SCAN-TRANSIENT";

export function createLocalTestScanner(): MalwareScanner {
  return {
    engine: "local_test",
    async scan({ bytes, mimeType }) {
      const text = Buffer.from(bytes).toString("latin1");
      if (text.includes(EICAR_SIGNATURE)) return { result: "malicious" };
      if (text.includes(TRANSIENT_MARKER)) {
        return { result: "transient_failure", errorCode: "provider_unavailable" };
      }
      if (mimeType === "application/pdf" && !text.includes("%%EOF"))
        return { result: "unscannable" };
      return { result: "clean" };
    },
  };
}
