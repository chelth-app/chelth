import { createHash } from "node:crypto";

import type { MalwareScanner, ScanErrorCode, ScanVerdict } from "./types";

/**
 * Credential-document scan worker (P0-E9-2). Claims documents from the
 * database queue, fetches each object through the scanner principal's
 * claim-scoped Storage access, verifies the bytes are exactly the ones
 * validated at upload (size + SHA-256), scans them and reports one outcome.
 *
 * Fail-closed: only a positive `clean` verdict on matching bytes can make a
 * document clean, and the database re-checks the hash before accepting it.
 * Nothing here logs object paths, bytes, URLs or provider text.
 */
export type ClaimedScan = {
  documentId: string;
  claimToken: string;
  objectPath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  attempt: number;
};

/** Outcomes accepted by public.complete_document_scan. */
export type ScanOutcome =
  "clean" | "malicious" | "unscannable" | "integrity_mismatch" | "transient_failure";

export type ScanHealth = {
  pendingDue: number;
  retrying: number;
  processing: number;
  failed: number;
  stuck: number;
  oldestScanningAt: string | null;
};

export type ScanStore = {
  claim(limit: number, leaseSeconds: number): Promise<ClaimedScan[]>;
  /** Throws when the object cannot be read (treated as transient). */
  download(objectPath: string): Promise<Uint8Array>;
  complete(input: {
    documentId: string;
    claimToken: string;
    outcome: ScanOutcome;
    observedSha256: string | null;
    engine: string;
    errorCode: ScanErrorCode | null;
  }): Promise<string>;
  health(): Promise<ScanHealth>;
};

export type ScanLogger = {
  info(message: string, context: Record<string, unknown>): void;
  warn(message: string, context: Record<string, unknown>): void;
};

export type ScanRunResult = {
  claimed: number;
  clean: number;
  quarantined: number;
  rejected: number;
  retrying: number;
  failed: number;
  stale: number;
  health: ScanHealth;
};

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Maps a provider verdict to the database outcome vocabulary. */
export function outcomeForVerdict(verdict: ScanVerdict): {
  outcome: ScanOutcome;
  errorCode: ScanErrorCode | null;
} {
  switch (verdict.result) {
    case "clean":
      return { outcome: "clean", errorCode: null };
    case "malicious":
      return { outcome: "malicious", errorCode: null };
    case "unscannable":
      return { outcome: "unscannable", errorCode: null };
    default:
      return { outcome: "transient_failure", errorCode: verdict.errorCode };
  }
}

async function scanOne(
  item: ClaimedScan,
  store: ScanStore,
  scanner: MalwareScanner,
): Promise<{
  outcome: ScanOutcome;
  observedSha256: string | null;
  errorCode: ScanErrorCode | null;
}> {
  let bytes: Uint8Array;
  try {
    bytes = await store.download(item.objectPath);
  } catch {
    // Missing and forbidden are indistinguishable from here: retry, then the
    // database marks the scan failed for operator attention. Never clean.
    return { outcome: "transient_failure", observedSha256: null, errorCode: "object_unavailable" };
  }
  const observedSha256 = sha256Hex(bytes);
  if (bytes.byteLength !== item.sizeBytes || !item.sha256 || observedSha256 !== item.sha256) {
    return { outcome: "integrity_mismatch", observedSha256, errorCode: null };
  }
  const verdict = await scanner.scan({ bytes, mimeType: item.mimeType });
  return { ...outcomeForVerdict(verdict), observedSha256 };
}

export async function runDocumentScans(options: {
  store: ScanStore;
  scanner: MalwareScanner;
  batchSize?: number;
  leaseSeconds?: number;
  logger?: ScanLogger;
}): Promise<ScanRunResult> {
  const { store, scanner, logger } = options;
  const result: Omit<ScanRunResult, "health"> = {
    claimed: 0,
    clean: 0,
    quarantined: 0,
    rejected: 0,
    retrying: 0,
    failed: 0,
    stale: 0,
  };

  const claimed = await store.claim(options.batchSize ?? 5, options.leaseSeconds ?? 300);
  result.claimed = claimed.length;

  for (const item of claimed) {
    const scanned = await scanOne(item, store, scanner);
    const state = await store.complete({
      documentId: item.documentId,
      claimToken: item.claimToken,
      outcome: scanned.outcome,
      observedSha256: scanned.observedSha256,
      engine: scanner.engine,
      errorCode: scanned.errorCode,
    });
    if (state === "clean") result.clean += 1;
    else if (state === "quarantined") result.quarantined += 1;
    else if (state === "rejected") result.rejected += 1;
    else if (state === "retry") result.retrying += 1;
    else if (state === "failed") result.failed += 1;
    else result.stale += 1;

    const context = {
      documentId: item.documentId,
      attempt: item.attempt,
      outcome: scanned.outcome,
      state,
      errorCode: scanned.errorCode,
      engine: scanner.engine,
    };
    if (state === "quarantined" || state === "failed" || scanned.outcome === "transient_failure") {
      logger?.warn("Document scan result", context);
    } else {
      logger?.info("Document scan result", context);
    }
  }

  const health = await store.health();
  // Machine-observable backlog signal (E9-4 wires alerting to it).
  if (health.failed > 0 || health.stuck > 0) {
    logger?.warn("Document scan backlog needs attention", { ...health });
  }
  return { ...result, health };
}
