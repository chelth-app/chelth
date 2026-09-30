import { describe, expect, it } from "vitest";

import {
  COMPLIANCE_REASON_LABELS,
  contentMatchesMimeType,
  extensionMatchesMimeType,
  isAllowedDocumentMimeType,
} from "@/lib/domain/credentials";
import { Constants } from "@/types/database.types";

const bytes = (...values: number[]) => new Uint8Array([...values, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("document validation", () => {
  it("allows only PDF, JPEG and PNG", () => {
    expect(isAllowedDocumentMimeType("application/pdf")).toBe(true);
    expect(isAllowedDocumentMimeType("image/png")).toBe(true);
    expect(isAllowedDocumentMimeType("text/html")).toBe(false);
    expect(isAllowedDocumentMimeType("image/svg+xml")).toBe(false);
    expect(isAllowedDocumentMimeType("application/x-msdownload")).toBe(false);
  });

  it("requires the file extension to match the declared type", () => {
    expect(extensionMatchesMimeType("licence.PDF", "application/pdf")).toBe(true);
    expect(extensionMatchesMimeType("photo.jpeg", "image/jpeg")).toBe(true);
    expect(extensionMatchesMimeType("invoice.pdf.exe", "application/pdf")).toBe(false);
    expect(extensionMatchesMimeType("scan.png", "application/pdf")).toBe(false);
  });

  it("checks magic bytes, not just labels", () => {
    expect(contentMatchesMimeType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d), "application/pdf")).toBe(
      true,
    );
    expect(
      contentMatchesMimeType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "image/png"),
    ).toBe(true);
    expect(contentMatchesMimeType(bytes(0xff, 0xd8, 0xff), "image/jpeg")).toBe(true);
    // An executable (MZ) or HTML renamed to .pdf is refused.
    expect(contentMatchesMimeType(bytes(0x4d, 0x5a), "application/pdf")).toBe(false);
    expect(
      contentMatchesMimeType(new TextEncoder().encode("<html><script>"), "application/pdf"),
    ).toBe(false);
    expect(contentMatchesMimeType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d), "image/png")).toBe(false);
  });
});

describe("compliance reason vocabulary", () => {
  it("labels every reason code the engine can return", () => {
    expect(Object.keys(COMPLIANCE_REASON_LABELS).sort()).toEqual(
      [...Constants.public.Enums.compliance_reason].sort(),
    );
  });
});
