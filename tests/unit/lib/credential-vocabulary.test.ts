import { describe, expect, it } from "vitest";

import {
  checkDocumentFile,
  COMPLIANCE_REASON_LABELS,
  contentMatchesMimeType,
  extensionMatchesMimeType,
  isAllowedDocumentMimeType,
  MAX_DOCUMENT_BYTES,
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

describe("checkDocumentFile (worker upload pre-check, P0-E9-3C)", () => {
  const file = (name: string, type: string, size = 2048) => ({ name, type, size });

  it.each([
    ["licence.pdf", "application/pdf", "application/pdf"],
    ["IMG_2041.JPG", "image/jpeg", "image/jpeg"],
    ["photo.jpeg", "image/jpg", "image/jpeg"],
    ["Screenshot_20261009.png", "image/png", "image/png"],
  ])("accepts %s (%s)", (name, type, expected) => {
    expect(checkDocumentFile(file(name, type))).toEqual({
      ok: true,
      mimeType: expected,
      uploadName: name,
    });
  });

  it("takes the type from the extension when the picker reports none", () => {
    expect(checkDocumentFile(file("bls.pdf", ""))).toMatchObject({
      ok: true,
      mimeType: "application/pdf",
    });
    expect(checkDocumentFile(file("card.png", "application/octet-stream"))).toMatchObject({
      ok: true,
      mimeType: "image/png",
    });
  });

  it("names an extension-less file from its declared type", () => {
    expect(checkDocumentFile(file("1000012345", "image/jpeg"))).toEqual({
      ok: true,
      mimeType: "image/jpeg",
      uploadName: "1000012345.jpg",
    });
  });

  it.each([
    ["no type from either source", file("document", "")],
    ["unsupported type", file("photo.heic", "image/heic")],
    ["a contradicting extension", file("invoice.html", "application/pdf")],
    ["a PDF named as an image", file("scan.png", "application/pdf")],
    ["a script", file("run.exe", "application/x-msdownload")],
  ])("refuses %s", (_label, candidate) => {
    expect(checkDocumentFile(candidate)).toEqual({ ok: false, reason: "type" });
  });

  it("refuses empty and oversized files", () => {
    expect(checkDocumentFile(file("a.pdf", "application/pdf", 0))).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(checkDocumentFile(file("a.pdf", "application/pdf", MAX_DOCUMENT_BYTES))).toMatchObject({
      ok: true,
    });
    expect(checkDocumentFile(file("a.pdf", "application/pdf", MAX_DOCUMENT_BYTES + 1))).toEqual({
      ok: false,
      reason: "size",
    });
  });
});
