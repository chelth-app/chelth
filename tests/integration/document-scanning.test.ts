import { beforeAll, describe, expect, it } from "vitest";

import { CREDENTIAL_DOCUMENT_BUCKET } from "@/lib/domain/credentials";
import {
  createLocalTestScanner,
  EICAR_SIGNATURE,
  TRANSIENT_MARKER,
} from "@/lib/scanning/providers/local-test";
import { createScannerStore } from "@/lib/scanning/supabase-store";
import type { MalwareScanner } from "@/lib/scanning/types";
import { runDocumentScans, sha256Hex } from "@/lib/scanning/worker";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./support/env";
import { ownerQuery, PASSWORD, signUpVerified, type TestIdentity } from "./support/identities";
import { isoDay, must, run } from "./support/staffing";

/*
 * P0-E9-2 document scanning end to end on the local stack: a real scanner
 * principal (Auth + registry), real uploads through signed Storage URLs with
 * real SHA-256 hashes, the real Storage policies and the database queue. The
 * provider is the deterministic local stub (EICAR signature).
 */

const encode = (text: string) => new TextEncoder().encode(text);
const PDF = encode("%PDF-1.4\n% Chelth scan test: clean\n%%EOF\n");
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
]);
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
]);
const EICAR_PDF = encode(`%PDF-1.4\n${EICAR_SIGNATURE}\n%%EOF\n`);
const CORRUPT_PDF = encode("%PDF-1.4\n1 0 obj << /Type /Cat");
const FLAKY_PDF = encode(`%PDF-1.4\n${TRANSIENT_MARKER}\n%%EOF\n`);

async function draftVersion(worker: TestIdentity): Promise<string> {
  const created = await must(
    worker.client.rpc("create_credential", {
      p_credential_type_key: "bls_certification",
      p_issuing_authority: "American Heart Association",
      p_issue_date: isoDay(-30),
      p_expiry_date: isoDay(700),
    }),
  );
  return created[0]?.credential_version_id ?? "";
}

/** Upload exactly as the browser + completeUploadAction do (real SHA-256). */
async function upload(
  worker: TestIdentity,
  versionId: string,
  bytes: Uint8Array,
  mimeType: string,
  recordedSha = sha256Hex(bytes),
): Promise<string> {
  const begun = await must(
    worker.client.rpc("begin_credential_document_upload", {
      p_credential_version_id: versionId,
      p_mime_type: mimeType,
      p_size_bytes: bytes.byteLength,
    }),
  );
  const documentId = begun[0]?.document_id ?? "";
  const path = begun[0]?.object_path ?? "";
  const ticket = await worker.client.storage
    .from(CREDENTIAL_DOCUMENT_BUCKET)
    .createSignedUploadUrl(path);
  if (ticket.error) throw ticket.error;
  const uploaded = await worker.client.storage
    .from(CREDENTIAL_DOCUMENT_BUCKET)
    .uploadToSignedUrl(ticket.data.path, ticket.data.token, bytes, { contentType: mimeType });
  if (uploaded.error) throw uploaded.error;
  await run(
    worker.client.rpc("complete_credential_document_upload", {
      p_document_id: documentId,
      p_sha256: recordedSha,
      p_content_valid: true,
    }),
  );
  return documentId;
}

async function statusOf(documentId: string): Promise<string> {
  const rows = await ownerQuery(
    (sql) =>
      sql<{ s: string }[]>`select status::text || coalesce('/' || status_reason, '') as s
                           from public.credential_documents where id = ${documentId}::uuid`,
  );
  return rows[0]?.s ?? "missing";
}

async function queueOf(documentId: string) {
  const rows = await ownerQuery(
    (sql) =>
      sql<
        { state: string; attempts: number }[]
      >`select state, attempts from internal.document_scan_queue
                                                where document_id = ${documentId}::uuid`,
  );
  return rows[0];
}

/**
 * Keeps only this test's documents due, so a batch is deterministic even when
 * other local runs (E2E) left pending scans behind (the scanner claims the
 * oldest due rows first).
 */
async function onlyDue(documentIds: string[]) {
  await ownerQuery(
    (sql) => sql`update internal.document_scan_queue
                 set next_attempt_at = case when document_id = any(${documentIds}::uuid[])
                                            then now() - interval '1 second'
                                            else now() + interval '1 day' end
                 where state = 'pending'`,
  );
}

describe("credential document malware scanning (P0-E9-2)", () => {
  let scannerIdentity: TestIdentity;
  let worker: TestIdentity;
  let versionId: string;

  const store = () =>
    createScannerStore({
      supabaseUrl: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
      email: scannerIdentity.email,
      password: PASSWORD,
    });

  beforeAll(async () => {
    scannerIdentity = await signUpVerified("scanner");
    await ownerQuery(
      (sql) =>
        sql`select internal.register_document_scanner(${scannerIdentity.userId}::uuid, 'integration scanner')`,
    );
    worker = await signUpVerified("scanworker");
    versionId = await draftVersion(worker);
  });

  it("clears clean PDF, JPEG and PNG uploads through the real pipeline", async () => {
    const ids = [
      await upload(worker, versionId, PDF, "application/pdf"),
      await upload(worker, versionId, JPEG, "image/jpeg"),
      await upload(worker, versionId, PNG, "image/png"),
    ];
    for (const id of ids) expect(await statusOf(id)).toBe("scanning");
    await onlyDue(ids);

    const scanStore = await store();
    try {
      const result = await runDocumentScans({
        store: scanStore,
        scanner: createLocalTestScanner(),
      });
      expect(result.claimed).toBeGreaterThanOrEqual(3);
    } finally {
      await scanStore.close();
    }
    for (const id of ids) {
      expect(await statusOf(id)).toBe("clean");
      expect((await queueOf(id))?.state).toBe("completed");
    }
    // Clean is not verification: the scanner never records a credential decision.
    const decisions = await ownerQuery(
      (sql) => sql<{ n: number }[]>`select count(*)::int as n from public.credential_verifications
                                    where credential_version_id = ${versionId}::uuid`,
    );
    expect(decisions[0]?.n).toBe(0);
  });

  it("quarantines EICAR, rejects corrupt files and quarantines byte/hash mismatches", async () => {
    const second = await draftVersion(worker);
    const eicar = await upload(worker, second, EICAR_PDF, "application/pdf");
    const corrupt = await upload(worker, second, CORRUPT_PDF, "application/pdf");
    const mismatched = await upload(worker, second, PDF, "application/pdf", "c".repeat(64));
    await onlyDue([eicar, corrupt, mismatched]);

    const scanStore = await store();
    try {
      await runDocumentScans({ store: scanStore, scanner: createLocalTestScanner() });
    } finally {
      await scanStore.close();
    }
    expect(await statusOf(eicar)).toBe("quarantined/malware_detected");
    expect(await statusOf(corrupt)).toBe("rejected/unscannable");
    expect(await statusOf(mismatched)).toBe("quarantined/integrity_mismatch");

    // The owner can no longer see or download the quarantined object.
    const row = await worker.client.from("credential_documents").select("id").eq("id", eicar);
    expect(row.data).toEqual([]);
    const access = await worker.client.rpc("authorize_credential_document_access", {
      p_document_id: eicar,
    });
    expect(access.data ?? []).toEqual([]);
  });

  it("retries a transient provider failure without changing trust state", async () => {
    const third = await draftVersion(worker);
    const flaky = await upload(worker, third, FLAKY_PDF, "application/pdf");
    await onlyDue([flaky]);
    const scanStore = await store();
    try {
      const result = await runDocumentScans({
        store: scanStore,
        scanner: createLocalTestScanner(),
      });
      expect(result.retrying).toBeGreaterThanOrEqual(1);
    } finally {
      await scanStore.close();
    }
    expect(await statusOf(flaky)).toBe("scanning");
    expect(await queueOf(flaky)).toEqual({ state: "pending", attempts: 1 });
  });

  it("lets two concurrent workers process each document exactly once", async () => {
    const fourth = await draftVersion(worker);
    const docs = [
      await upload(worker, fourth, encode("%PDF-1.4\n% a\n%%EOF\n"), "application/pdf"),
      await upload(worker, fourth, encode("%PDF-1.4\n% b\n%%EOF\n"), "application/pdf"),
      await upload(worker, fourth, encode("%PDF-1.4\n% c\n%%EOF\n"), "application/pdf"),
    ];
    const seen: string[] = [];
    const counting: MalwareScanner = {
      engine: "local_test",
      async scan(input) {
        seen.push(sha256Hex(input.bytes));
        await new Promise((resolve) => setTimeout(resolve, 150));
        return createLocalTestScanner().scan(input);
      },
    };
    const [a, b] = await Promise.all([store(), store()]);
    try {
      await Promise.all([
        runDocumentScans({ store: a, scanner: counting }),
        runDocumentScans({ store: b, scanner: counting }),
      ]);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
    for (const id of docs) expect(await statusOf(id)).toBe("clean");
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("recovers a stale lease and refuses the superseded claim", async () => {
    const fifth = await draftVersion(worker);
    const doc = await upload(
      worker,
      fifth,
      encode("%PDF-1.4\n% stale\n%%EOF\n"),
      "application/pdf",
    );
    const first = await store();
    const second = await store();
    try {
      const [claim] = (await first.claim(5, 60)).filter((c) => c.documentId === doc);
      expect(claim).toBeDefined();
      await ownerQuery(
        (
          sql,
        ) => sql`update internal.document_scan_queue set claimed_until = now() - interval '1 second'
                     where document_id = ${doc}::uuid`,
      );
      const result = await runDocumentScans({ store: second, scanner: createLocalTestScanner() });
      expect(result.clean).toBeGreaterThanOrEqual(1);
      const late = await first.complete({
        documentId: doc,
        claimToken: claim?.claimToken ?? "",
        outcome: "clean",
        observedSha256: claim?.sha256 ?? null,
        engine: "local_test",
        errorCode: null,
      });
      expect(late).toBe("stale_claim");
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
    expect(await statusOf(doc)).toBe("clean");
  });

  it("keeps the scanner principal out of the application and other identities out of the scanner API", async () => {
    const scanStore = await store();
    await scanStore.close();
    const asScanner = await signUpVerified("not-a-scanner");
    const claim = await asScanner.client.rpc("claim_document_scans", {
      p_limit: 1,
      p_lease_seconds: 60,
    });
    expect(claim.error?.code).toBe("CH403");
    const forged = await worker.client.rpc("complete_document_scan", {
      p_document_id: "00000000-0000-4000-8000-000000000000",
      p_claim_token: "00000000-0000-4000-8000-000000000000",
      p_outcome: "clean",
    });
    expect(forged.error?.code).toBe("CH403");
  });
});
