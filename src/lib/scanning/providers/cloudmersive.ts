import type { MalwareScanner, ScanVerdict } from "../types";

/**
 * Cloudmersive Virus Scan API adapter (advanced file scan).
 *
 * The advanced endpoint also refuses active content that is dangerous in
 * credential evidence (scripts, macros, executables, password-protected or
 * invalid files) and restricts the file types to PDF / JPEG / PNG.
 *
 * Mapping is fail-closed:
 *   CleanResult === true                    → clean
 *   viruses found                           → malicious
 *   invalid / encrypted / restricted format → unscannable
 *   any other CleanResult === false         → malicious (unsafe active content)
 *   timeout, 408/429/5xx, auth, bad body    → transient_failure
 * The API key travels only in a request header; provider text is never
 * returned, stored or logged.
 */
const ENDPOINT = "https://api.cloudmersive.com/virus/scan/file/advanced";

const POLICY_HEADERS = {
  allowExecutables: "false",
  allowInvalidFiles: "false",
  allowScripts: "false",
  allowPasswordProtectedFiles: "false",
  allowMacros: "false",
  allowXmlExternalEntities: "false",
  allowInsecureDeserialization: "false",
  allowHtml: "false",
  restrictFileTypes: ".pdf,.jpg,.jpeg,.png",
};

const EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

type AdvancedScanResponse = {
  CleanResult?: unknown;
  FoundViruses?: unknown;
  ContainsInvalidFile?: unknown;
  ContainsPasswordProtectedFile?: unknown;
  ContainsRestrictedFileFormat?: unknown;
};

/** Pure mapping, exported for tests. */
export function verdictFromCloudmersive(status: number, body: unknown): ScanVerdict {
  if (status === 408) return { result: "transient_failure", errorCode: "provider_timeout" };
  if (status === 429) return { result: "transient_failure", errorCode: "provider_rate_limited" };
  if (status === 401 || status === 403)
    return { result: "transient_failure", errorCode: "provider_auth" };
  if (status >= 500) return { result: "transient_failure", errorCode: "provider_unavailable" };
  if (status < 200 || status >= 300)
    return { result: "transient_failure", errorCode: "provider_error" };

  if (typeof body !== "object" || body === null) {
    return { result: "transient_failure", errorCode: "provider_malformed" };
  }
  const response = body as AdvancedScanResponse;
  if (typeof response.CleanResult !== "boolean") {
    return { result: "transient_failure", errorCode: "provider_malformed" };
  }
  if (response.CleanResult === true) return { result: "clean" };
  if (Array.isArray(response.FoundViruses) && response.FoundViruses.length > 0) {
    return { result: "malicious" };
  }
  if (
    response.ContainsInvalidFile === true ||
    response.ContainsPasswordProtectedFile === true ||
    response.ContainsRestrictedFileFormat === true
  ) {
    return { result: "unscannable" };
  }
  // Not clean for another reason (script, macro, executable, …): quarantine.
  return { result: "malicious" };
}

export function createCloudmersiveScanner(options: {
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): MalwareScanner {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    engine: "cloudmersive",
    async scan({ bytes, mimeType }) {
      const form = new FormData();
      const extension = EXTENSION[mimeType] ?? "bin";
      form.append(
        "inputFile",
        new Blob([new Uint8Array(bytes)], { type: mimeType }),
        `document.${extension}`,
      );
      try {
        const response = await fetchImpl(ENDPOINT, {
          method: "POST",
          headers: { Apikey: options.apiKey, ...POLICY_HEADERS },
          body: form,
          signal: AbortSignal.timeout(options.timeoutMs ?? 25_000),
          cache: "no-store",
        });
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        return verdictFromCloudmersive(response.status, body);
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        return {
          result: "transient_failure",
          errorCode: timedOut ? "provider_timeout" : "provider_unavailable",
        };
      }
    },
  };
}
