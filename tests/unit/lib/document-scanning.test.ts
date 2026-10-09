import { describe, expect, it, vi } from "vitest";

import { parseServerEnv } from "@/config/env.server.schema";
import { getMalwareScanner } from "@/lib/scanning";
import {
  createCloudmersiveScanner,
  verdictFromCloudmersive,
} from "@/lib/scanning/providers/cloudmersive";
import {
  createLocalTestScanner,
  EICAR_SIGNATURE,
  TRANSIENT_MARKER,
} from "@/lib/scanning/providers/local-test";
import type { MalwareScanner, ScanVerdict } from "@/lib/scanning/types";
import {
  outcomeForVerdict,
  runDocumentScans,
  sha256Hex,
  type ClaimedScan,
  type ScanStore,
} from "@/lib/scanning/worker";

/*
 * P0-E9-2 document scanning: provider-neutral, fail-closed worker logic and
 * the provider mapping. The database side is covered by pgTAP 260 and the
 * integration suite.
 */

const PDF = new TextEncoder().encode("%PDF-1.4\n% test\n%%EOF\n");

function claimFor(bytes: Uint8Array, overrides: Partial<ClaimedScan> = {}): ClaimedScan {
  return {
    documentId: "00000000-0000-4000-8000-000000000001",
    claimToken: "00000000-0000-4000-8000-0000000000aa",
    objectPath: "p/c/v/d",
    mimeType: "application/pdf",
    sizeBytes: bytes.byteLength,
    sha256: sha256Hex(bytes),
    attempt: 1,
    ...overrides,
  };
}

function fakeStore(claims: ClaimedScan[], objects: Record<string, Uint8Array | Error>) {
  const completed: Parameters<ScanStore["complete"]>[0][] = [];
  const store: ScanStore = {
    claim: vi.fn(async () => claims),
    download: vi.fn(async (path: string) => {
      const object = objects[path];
      if (!object || object instanceof Error) throw object ?? new Error("missing");
      return object;
    }),
    complete: vi.fn(async (input: Parameters<ScanStore["complete"]>[0]) => {
      completed.push(input);
      return {
        clean: "clean",
        malicious: "quarantined",
        integrity_mismatch: "quarantined",
        unscannable: "rejected",
        transient_failure: "retry",
      }[input.outcome];
    }),
    health: vi.fn(async () => ({
      pendingDue: 0,
      retrying: 0,
      processing: 0,
      failed: 0,
      stuck: 0,
      oldestScanningAt: null,
    })),
  };
  return { store, completed };
}

function scannerReturning(verdict: ScanVerdict): MalwareScanner & { calls: number } {
  const scanner = {
    engine: "fake",
    calls: 0,
    async scan() {
      scanner.calls += 1;
      return verdict;
    },
  };
  return scanner;
}

describe("document scan worker (fail-closed)", () => {
  it("reports clean only for a clean verdict on the exact validated bytes", async () => {
    const { store, completed } = fakeStore([claimFor(PDF)], { "p/c/v/d": PDF });
    const result = await runDocumentScans({
      store,
      scanner: scannerReturning({ result: "clean" }),
    });
    expect(completed[0]).toMatchObject({
      outcome: "clean",
      observedSha256: sha256Hex(PDF),
      errorCode: null,
    });
    expect(result).toMatchObject({ claimed: 1, clean: 1 });
  });

  it("never scans bytes whose SHA-256 differs from the upload, and quarantines them", async () => {
    const other = new TextEncoder().encode("%PDF-1.4\n% swapped\n%%EOF\n");
    const { store, completed } = fakeStore([claimFor(PDF)], { "p/c/v/d": other });
    const scanner = scannerReturning({ result: "clean" });
    await runDocumentScans({ store, scanner });
    expect(scanner.calls).toBe(0);
    expect(completed[0]?.outcome).toBe("integrity_mismatch");
  });

  it("treats a size mismatch or a missing recorded hash as an integrity failure", async () => {
    for (const claim of [claimFor(PDF, { sizeBytes: 1 }), claimFor(PDF, { sha256: null })]) {
      const { store, completed } = fakeStore([claim], { "p/c/v/d": PDF });
      await runDocumentScans({ store, scanner: scannerReturning({ result: "clean" }) });
      expect(completed[0]?.outcome).toBe("integrity_mismatch");
    }
  });

  it("retries (never clean, never terminal) when the object cannot be fetched", async () => {
    const { store, completed } = fakeStore([claimFor(PDF)], { "p/c/v/d": new Error("403") });
    const scanner = scannerReturning({ result: "clean" });
    await runDocumentScans({ store, scanner });
    expect(scanner.calls).toBe(0);
    expect(completed[0]).toMatchObject({
      outcome: "transient_failure",
      errorCode: "object_unavailable",
    });
  });

  it("maps every verdict to the database vocabulary", () => {
    expect(outcomeForVerdict({ result: "clean" }).outcome).toBe("clean");
    expect(outcomeForVerdict({ result: "malicious" }).outcome).toBe("malicious");
    expect(outcomeForVerdict({ result: "unscannable" }).outcome).toBe("unscannable");
    expect(
      outcomeForVerdict({ result: "transient_failure", errorCode: "provider_timeout" }),
    ).toEqual({ outcome: "transient_failure", errorCode: "provider_timeout" });
  });

  it("logs no object paths and flags a backlog through the health signal", async () => {
    const { store } = fakeStore([claimFor(PDF)], { "p/c/v/d": PDF });
    vi.mocked(store.health).mockResolvedValue({
      pendingDue: 0,
      retrying: 0,
      processing: 0,
      failed: 1,
      stuck: 2,
      oldestScanningAt: "2026-10-09T00:00:00Z",
    });
    const warn = vi.fn();
    const info = vi.fn();
    await runDocumentScans({
      store,
      scanner: scannerReturning({ result: "clean" }),
      logger: { info, warn },
    });
    expect(warn).toHaveBeenCalledWith(
      "Document scan backlog needs attention",
      expect.objectContaining({ failed: 1, stuck: 2 }),
    );
    expect(JSON.stringify([...info.mock.calls, ...warn.mock.calls])).not.toContain("p/c/v/d");
  });
});

describe("Cloudmersive adapter mapping (fail-closed)", () => {
  it("is clean only on an explicit boolean CleanResult true", () => {
    expect(verdictFromCloudmersive(200, { CleanResult: true })).toEqual({ result: "clean" });
    expect(verdictFromCloudmersive(200, { CleanResult: "true" })).toMatchObject({
      result: "transient_failure",
      errorCode: "provider_malformed",
    });
    expect(verdictFromCloudmersive(200, null).result).toBe("transient_failure");
    expect(verdictFromCloudmersive(200, {}).result).toBe("transient_failure");
  });

  it("quarantines viruses and unsafe active content; rejects invalid or encrypted files", () => {
    expect(
      verdictFromCloudmersive(200, { CleanResult: false, FoundViruses: [{ VirusName: "EICAR" }] }),
    ).toEqual({ result: "malicious" });
    expect(verdictFromCloudmersive(200, { CleanResult: false, FoundViruses: null })).toEqual({
      result: "malicious",
    });
    for (const flag of [
      "ContainsInvalidFile",
      "ContainsPasswordProtectedFile",
      "ContainsRestrictedFileFormat",
    ]) {
      expect(verdictFromCloudmersive(200, { CleanResult: false, [flag]: true })).toEqual({
        result: "unscannable",
      });
    }
  });

  it("treats every provider/infrastructure failure as transient", () => {
    expect(verdictFromCloudmersive(429, null)).toMatchObject({
      errorCode: "provider_rate_limited",
    });
    expect(verdictFromCloudmersive(503, null)).toMatchObject({ errorCode: "provider_unavailable" });
    expect(verdictFromCloudmersive(500, { CleanResult: true })).toMatchObject({
      result: "transient_failure",
    });
    expect(verdictFromCloudmersive(401, null)).toMatchObject({ errorCode: "provider_auth" });
    expect(verdictFromCloudmersive(408, null)).toMatchObject({ errorCode: "provider_timeout" });
    expect(verdictFromCloudmersive(400, { CleanResult: true })).toMatchObject({
      errorCode: "provider_error",
    });
  });

  it("sends the key only as a header, applies the content policy and never throws", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ CleanResult: true }));
    const scanner = createCloudmersiveScanner({ apiKey: "k".repeat(32), fetchImpl });
    await expect(scanner.scan({ bytes: PDF, mimeType: "application/pdf" })).resolves.toEqual({
      result: "clean",
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudmersive.com/virus/scan/file/advanced");
    expect(url).not.toContain("k".repeat(32));
    expect(init.headers).toMatchObject({
      Apikey: "k".repeat(32),
      allowScripts: "false",
      allowMacros: "false",
    });

    const failing = createCloudmersiveScanner({
      apiKey: "k".repeat(32),
      fetchImpl: vi.fn(async () => {
        throw new TypeError("network down");
      }),
    });
    await expect(failing.scan({ bytes: PDF, mimeType: "application/pdf" })).resolves.toEqual({
      result: "transient_failure",
      errorCode: "provider_unavailable",
    });
    const timingOut = createCloudmersiveScanner({
      apiKey: "k".repeat(32),
      fetchImpl: vi.fn(async () => {
        throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
      }),
    });
    await expect(
      timingOut.scan({ bytes: PDF, mimeType: "application/pdf" }),
    ).resolves.toMatchObject({
      errorCode: "provider_timeout",
    });
  });
});

describe("local test scanner and provider selection", () => {
  it("detects EICAR, corrupt PDFs and the transient marker deterministically", async () => {
    const scanner = createLocalTestScanner();
    const encode = (text: string) => new TextEncoder().encode(text);
    await expect(
      scanner.scan({
        bytes: encode(`%PDF-1.4\n${EICAR_SIGNATURE}\n%%EOF`),
        mimeType: "application/pdf",
      }),
    ).resolves.toEqual({ result: "malicious" });
    await expect(
      scanner.scan({ bytes: encode("%PDF-1.4\ntruncated"), mimeType: "application/pdf" }),
    ).resolves.toEqual({ result: "unscannable" });
    await expect(
      scanner.scan({
        bytes: encode(`%PDF-1.4\n${TRANSIENT_MARKER}\n%%EOF`),
        mimeType: "application/pdf",
      }),
    ).resolves.toMatchObject({ result: "transient_failure" });
    await expect(scanner.scan({ bytes: PDF, mimeType: "application/pdf" })).resolves.toEqual({
      result: "clean",
    });
  });

  it("never allows the local stub in production and needs a key for the hosted provider", () => {
    expect(
      getMalwareScanner({ provider: "local_test", apiKey: undefined, production: true }),
    ).toBeNull();
    expect(
      getMalwareScanner({ provider: "local_test", apiKey: undefined, production: false })?.engine,
    ).toBe("local_test");
    expect(
      getMalwareScanner({ provider: "cloudmersive", apiKey: undefined, production: true }),
    ).toBeNull();
    expect(
      getMalwareScanner({ provider: "cloudmersive", apiKey: "k".repeat(32), production: true })
        ?.engine,
    ).toBe("cloudmersive");
    expect(
      getMalwareScanner({ provider: "disabled", apiKey: "k".repeat(32), production: true }),
    ).toBeNull();
  });

  it("validates the scanner environment (disabled by default; pairs; key required)", () => {
    expect(parseServerEnv({}).MALWARE_SCAN_PROVIDER).toBe("disabled");
    expect(() => parseServerEnv({ MALWARE_SCAN_PROVIDER: "cloudmersive" })).toThrow(
      /MALWARE_SCAN_API_KEY/,
    );
    expect(() => parseServerEnv({ DOCUMENT_SCANNER_EMAIL: "scanner@chelth.test" })).toThrow(
      /DOCUMENT_SCANNER/,
    );
    expect(() => parseServerEnv({ DOCUMENT_SCAN_DISPATCH_SECRET: "short" })).toThrow(/32/);
  });
});
