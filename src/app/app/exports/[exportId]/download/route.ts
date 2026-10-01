import {
  decodeVerifiedExport,
  exportIdSchema,
  exportResponseHeaders,
  isSameOriginRequest,
} from "@/features/financial";
import { getAuthIdentity } from "@/lib/auth/session";
import { normalizeError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { getRequestId } from "@/lib/request-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Streams a financial export to an authorised agency user.
 *
 * - POST only, same origin only (the download is audited).
 * - Signed-in users only; the database re-checks payroll.export /
 *   invoice.export for the export's own agency at AAL2 and writes the
 *   *.export_downloaded audit row in the same call.
 * - No URL is minted: the bytes never leave the database except through this
 *   per-request authorised path, so there is nothing to share, replay or expire.
 * - The checksum recorded at generation is re-verified before streaming.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/app/exports/[exportId]/download">,
) {
  const plain = (status: number, message: string) =>
    new Response(message, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });

  if (!isSameOriginRequest(request)) return plain(403, "Forbidden");
  const parsed = exportIdSchema.safeParse((await params).exportId);
  if (!parsed.success) return plain(404, "Not found");
  const identity = await getAuthIdentity();
  if (!identity) return plain(401, "Sign in to download this export.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("download_financial_export", {
    p_export_id: parsed.data,
  });
  if (error) {
    const appError = normalizeError(error);
    logger.info("Export download refused", {
      code: appError.code,
      requestId: getRequestId(),
    });
    if (appError.code === "MFA_REQUIRED") {
      return plain(403, "Verify with your authenticator app, then download again.");
    }
    return plain(appError.kind === "rate_limited" ? 429 : 404, "Not found");
  }
  const row = data[0];
  if (!row) return plain(404, "Not found");
  // Refusals are returned (and audited) by the database rather than raised.
  if (row.denied_reason) {
    logger.info("Export download refused", { code: row.denied_reason, requestId: getRequestId() });
    return row.denied_reason === "MFA_REQUIRED"
      ? plain(403, "Verify with your authenticator app, then download again.")
      : plain(404, "Not found");
  }

  const bytes = decodeVerifiedExport({
    contentBase64: row.content_base64,
    sha256: row.sha256,
    byteSize: row.byte_size,
  });
  const headers = exportResponseHeaders({
    fileName: row.file_name,
    contentType: row.content_type,
    sha256: row.sha256,
    byteSize: row.byte_size,
  });
  if (!bytes || !headers) {
    logger.error("Export failed its integrity check", { requestId: getRequestId() });
    return plain(500, "This export could not be verified.");
  }
  return new Response(new Uint8Array(bytes), { status: 200, headers });
}
