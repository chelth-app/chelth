/**
 * Credential-document malware scan worker (P0-E9-2). Server-to-server only:
 * called by the database scheduler (pg_cron → pg_net) or an operator, never by
 * browsers.
 *
 * - Authenticated by a bearer secret (constant-time comparison).
 * - Acts as the registered scanner principal (no service-role key, no
 *   database password): it can claim / complete scans and read only the
 *   objects it holds a claim on.
 * - Fail-closed: when anything is missing it scans nothing (503), and
 *   documents stay untrusted.
 * - Responds with counts only; never paths, URLs, bytes or provider text.
 *
 * Body `{ "selfTest": true }` scans a harmless sample and the EICAR test
 * string through the configured provider WITHOUT touching any document, to
 * verify the provider end to end.
 */
import { publicEnv } from "@/config/env.public";
import { serverEnv } from "@/config/env.server";
import { logger } from "@/lib/logging";
import { isAuthorizedDispatch } from "@/lib/notifications/dispatch-auth";
import { getMalwareScanner, runDocumentScans } from "@/lib/scanning";
import { EICAR_SIGNATURE } from "@/lib/scanning/providers/local-test";
import { createScannerStore } from "@/lib/scanning/supabase-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

const CLEAN_SAMPLE_PDF = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n",
);

export async function POST(request: Request) {
  const secret = serverEnv.DOCUMENT_SCAN_DISPATCH_SECRET;
  const email = serverEnv.DOCUMENT_SCANNER_EMAIL;
  const password = serverEnv.DOCUMENT_SCANNER_PASSWORD;
  const scanner = getMalwareScanner({
    provider: serverEnv.MALWARE_SCAN_PROVIDER,
    apiKey: serverEnv.MALWARE_SCAN_API_KEY,
    production: publicEnv.NEXT_PUBLIC_APP_ENV === "production",
  });
  if (!secret || !email || !password || !scanner) {
    return Response.json({ status: "not_configured" }, { status: 503, headers: NO_STORE });
  }
  if (!isAuthorizedDispatch(request.headers.get("authorization"), secret)) {
    return Response.json({ status: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const body = (await request.json().catch(() => null)) as { selfTest?: unknown } | null;
  if (body?.selfTest === true) {
    const [clean, eicar] = await Promise.all([
      scanner.scan({ bytes: CLEAN_SAMPLE_PDF, mimeType: "application/pdf" }),
      scanner.scan({
        bytes: new TextEncoder().encode(EICAR_SIGNATURE),
        mimeType: "application/pdf",
      }),
    ]);
    logger.info("Document scanner self-test", {
      engine: scanner.engine,
      clean: clean.result,
      eicar: eicar.result,
    });
    return Response.json(
      { status: "self_test", engine: scanner.engine, clean: clean.result, eicar: eicar.result },
      { headers: NO_STORE },
    );
  }

  let store: Awaited<ReturnType<typeof createScannerStore>> | null = null;
  try {
    store = await createScannerStore({
      supabaseUrl: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      email,
      password,
    });
    const result = await runDocumentScans({
      store,
      scanner,
      logger: {
        info: (message, context) => logger.info(message, context),
        warn: (message, context) => logger.warn(message, context),
      },
    });
    return Response.json(
      { status: "completed", engine: scanner.engine, ...result },
      { headers: NO_STORE },
    );
  } catch (error) {
    logger.error("Document scan run failed", { error });
    return Response.json({ status: "error" }, { status: 500, headers: NO_STORE });
  } finally {
    await store?.close().catch(() => undefined);
  }
}
