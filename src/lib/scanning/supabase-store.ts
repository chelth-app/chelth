import "server-only";

import { createScannerSessionClient } from "@/lib/supabase/scanner";

import type { ClaimedScan, ScanHealth, ScanStore } from "./worker";

/**
 * Scan store acting as the registered SCANNER PRINCIPAL (anon key + that
 * principal's own session). It holds no service-role key and no database
 * password: the database lets this identity claim / complete scans and read
 * only the Storage objects it currently holds a claim on.
 */
export const CREDENTIAL_DOCUMENT_BUCKET = "credential-documents";

export async function createScannerStore(options: {
  supabaseUrl: string;
  anonKey: string;
  email: string;
  password: string;
}): Promise<ScanStore & { close(): Promise<void> }> {
  const client = await createScannerSessionClient(options);

  return {
    async claim(limit, leaseSeconds) {
      const { data, error } = await client.rpc("claim_document_scans", {
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw new Error(`claim_document_scans failed (${error.code})`);
      return (data ?? []).map((row): ClaimedScan => ({
        documentId: row.document_id,
        claimToken: row.claim_token,
        objectPath: row.object_path,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
        attempt: row.attempt,
      }));
    },
    async download(objectPath) {
      const { data, error } = await client.storage
        .from(CREDENTIAL_DOCUMENT_BUCKET)
        .download(objectPath);
      if (error || !data) throw new Error("object unavailable");
      return new Uint8Array(await data.arrayBuffer());
    },
    async complete(input) {
      const { data, error } = await client.rpc("complete_document_scan", {
        p_document_id: input.documentId,
        p_claim_token: input.claimToken,
        p_outcome: input.outcome,
        p_observed_sha256: input.observedSha256 ?? undefined,
        p_engine: input.engine,
        p_error_code: input.errorCode ?? undefined,
      });
      if (error) throw new Error(`complete_document_scan failed (${error.code})`);
      return data as string;
    },
    async health(): Promise<ScanHealth> {
      const { data, error } = await client.rpc("document_scan_health");
      if (error) throw new Error(`document_scan_health failed (${error.code})`);
      const row = data?.[0];
      return {
        pendingDue: row?.pending_due ?? 0,
        retrying: row?.retrying ?? 0,
        processing: row?.processing ?? 0,
        failed: row?.failed ?? 0,
        stuck: row?.stuck ?? 0,
        oldestScanningAt: row?.oldest_scanning_at ?? null,
      };
    },
    async close() {
      await client.auth.signOut({ scope: "local" });
    },
  };
}
