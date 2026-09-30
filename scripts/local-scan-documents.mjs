#!/usr/bin/env node
/**
 * LOCAL DEVELOPMENT ONLY — plays the malware scanner for pending uploads.
 *
 *   npm run dev:scan-documents                # mark every `scanning` document clean
 *   npm run dev:scan-documents -- quarantine  # mark them quarantined instead
 *
 * Production has no equivalent: documents stay `scanning` until a real scanner
 * integration clears them (docs/security/CREDENTIAL_DOCUMENT_SECURITY.md).
 * Refuses to run against anything but a local database.
 */
import postgres from "postgres";

const url =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  console.error("local-scan-documents: refusing to run against a non-local database");
  process.exit(1);
}
const result = process.argv.includes("quarantine") ? "quarantined" : "clean";
const sql = postgres(url, { max: 1 });
try {
  const rows = await sql`
    select internal.record_document_scan_result(id, ${result}::public.document_status)
    from public.credential_documents where status = 'scanning'`;
  console.log(`local-scan-documents: marked ${rows.length} document(s) ${result}`);
} finally {
  await sql.end();
}
