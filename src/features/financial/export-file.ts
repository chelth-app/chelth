import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { safeExportFileName } from "@/lib/domain/financial";

/**
 * Decodes an export returned by download_financial_export and re-verifies it
 * against the checksum recorded when it was generated. Any mismatch fails
 * closed (null): a corrupted or substituted file is never served.
 */
export function decodeVerifiedExport(input: {
  contentBase64: string;
  sha256: string;
  byteSize: number;
}): Buffer | null {
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) return null;
  const bytes = Buffer.from(input.contentBase64, "base64");
  if (bytes.length !== input.byteSize) return null;
  const actual = createHash("sha256").update(bytes).digest();
  const expected = Buffer.from(input.sha256, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? bytes : null;
}

/** Response headers for a private, non-cacheable attachment. */
export function exportResponseHeaders(input: {
  fileName: string;
  contentType: string;
  sha256: string;
  byteSize: number;
}): Headers | null {
  const fileName = safeExportFileName(input.fileName);
  if (!fileName) return null;
  if (input.contentType !== "text/csv; charset=utf-8" && input.contentType !== "application/pdf") {
    return null;
  }
  return new Headers({
    "Content-Type": input.contentType,
    "Content-Length": String(input.byteSize),
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "X-Chelth-Export-SHA256": input.sha256,
  });
}

/**
 * A download is a state-changing request (it writes an audit row), so it is a
 * POST that must come from this origin.
 */
export function isSameOriginRequest(request: Request): boolean {
  const own = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === own;
  return request.headers.get("sec-fetch-site") === "same-origin";
}
