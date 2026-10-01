import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decodeVerifiedExport,
  exportResponseHeaders,
  isSameOriginRequest,
} from "@/features/financial/export-file";
import {
  createInvoiceDraftSchema,
  createPayrollBatchSchema,
  financialSettingsSchema,
  invoiceDraftActionSchema,
} from "@/features/financial/schemas";
import {
  attentionLabel,
  financialStatusTone,
  INVOICE_CSV_COLUMNS,
  PAYROLL_CSV_COLUMNS,
  safeExportFileName,
  shortChecksum,
} from "@/lib/domain/financial";

const ORG = "11111111-1111-4111-8111-111111111111";
const REL = "22222222-2222-4222-8222-222222222222";

function fileOf(text: string) {
  const bytes = Buffer.from(text, "utf8");
  return {
    contentBase64: bytes.toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.length,
  };
}

describe("export integrity (served bytes must match the recorded checksum)", () => {
  it("returns the exact bytes when checksum and size match (non-ASCII included)", () => {
    const file = fileOf('"José","a,b","say ""hi"""\r\n');
    expect(decodeVerifiedExport(file)?.toString("utf8")).toBe('"José","a,b","say ""hi"""\r\n');
  });

  it("fails closed on a checksum mismatch", () => {
    const file = fileOf("batch_reference\r\n");
    expect(decodeVerifiedExport({ ...file, sha256: "0".repeat(64) })).toBeNull();
  });

  it("fails closed on a size mismatch or a malformed checksum", () => {
    const file = fileOf("x");
    expect(decodeVerifiedExport({ ...file, byteSize: 2 })).toBeNull();
    expect(decodeVerifiedExport({ ...file, sha256: "ABC" })).toBeNull();
  });

  it("is deterministic: the same content always has the same checksum", () => {
    expect(fileOf("same\r\n").sha256).toBe(fileOf("same\r\n").sha256);
    expect(fileOf("same\r\n").sha256).not.toBe(fileOf("same\n").sha256);
  });
});

describe("download response", () => {
  const base = { contentType: "text/csv; charset=utf-8", sha256: "a".repeat(64), byteSize: 10 };

  it("is a private, non-cacheable attachment", () => {
    const headers = exportResponseHeaders({ ...base, fileName: "PAY-2026-000001.csv" });
    expect(headers?.get("Content-Disposition")).toBe('attachment; filename="PAY-2026-000001.csv"');
    expect(headers?.get("Cache-Control")).toContain("no-store");
    expect(headers?.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("refuses file names that could inject headers or traverse paths", () => {
    for (const fileName of [
      'x".csv',
      "../PAY.csv",
      "PAY\r\nSet-Cookie: a.csv",
      "pay.csv",
      "PAY.exe",
    ]) {
      expect(exportResponseHeaders({ ...base, fileName })).toBeNull();
    }
  });

  it("refuses unexpected content types", () => {
    expect(
      exportResponseHeaders({ ...base, fileName: "PAY-2026-000001.csv", contentType: "text/html" }),
    ).toBeNull();
  });

  it("accepts only same-origin POSTs", () => {
    const url = "http://localhost:3100/app/exports/x/download";
    expect(
      isSameOriginRequest(
        new Request(url, { method: "POST", headers: { origin: "http://localhost:3100" } }),
      ),
    ).toBe(true);
    expect(
      isSameOriginRequest(
        new Request(url, { method: "POST", headers: { origin: "https://evil.test" } }),
      ),
    ).toBe(false);
    expect(isSameOriginRequest(new Request(url, { method: "POST" }))).toBe(false);
    expect(
      isSameOriginRequest(
        new Request(url, { method: "POST", headers: { "sec-fetch-site": "same-origin" } }),
      ),
    ).toBe(true);
  });
});

describe("financial inputs carry identifiers only", () => {
  it("a client-supplied amount is never passed through", () => {
    const parsed = createPayrollBatchSchema.parse({
      organisationId: ORG,
      periodStart: "2026-09-14",
      currency: "USD",
      payAmountMinor: "1",
      totalPayMinor: "999999",
    });
    expect(Object.keys(parsed).sort()).toEqual(["currency", "organisationId", "periodStart"]);
    const draft = createInvoiceDraftSchema.parse({
      organisationId: ORG,
      relationshipId: REL,
      periodStart: "2026-09-14",
      currency: "USD",
      billAmountMinor: "1",
    });
    expect(Object.keys(draft).sort()).toEqual([
      "currency",
      "organisationId",
      "periodStart",
      "relationshipId",
    ]);
  });

  it("rejects unknown currencies, malformed dates and unknown steps", () => {
    expect(
      createPayrollBatchSchema.safeParse({
        organisationId: ORG,
        periodStart: "2026-09-14",
        currency: "XXX",
      }).success,
    ).toBe(false);
    expect(
      createPayrollBatchSchema.safeParse({
        organisationId: ORG,
        periodStart: "14/09/2026",
        currency: "USD",
      }).success,
    ).toBe(false);
    expect(
      invoiceDraftActionSchema.safeParse({ organisationId: ORG, draftId: REL, step: "send" })
        .success,
    ).toBe(false);
  });

  it("reference prefixes are capitals, digits and single hyphens", () => {
    const base = {
      organisationId: ORG,
      payrollPeriodType: "biweekly",
      payrollAnchorDate: "2026-09-14",
      invoiceReferencePrefix: "INV-DRAFT",
    };
    expect(
      financialSettingsSchema.safeParse({ ...base, payrollReferencePrefix: "PAY" }).success,
    ).toBe(true);
    for (const prefix of ["pay", "PAY-", "PAY--X", "=PAY", "PAY 1"]) {
      expect(
        financialSettingsSchema.safeParse({ ...base, payrollReferencePrefix: prefix }).success,
      ).toBe(false);
    }
  });
});

describe("financial vocabulary", () => {
  it("export columns are exactly as specified", () => {
    expect(PAYROLL_CSV_COLUMNS.join(",")).toBe(
      "batch_reference,worker_reference,worker_name,period_start,period_end,work_date,facility,discipline,regular_minutes,overtime_minutes,pay_rate_minor,pay_amount_minor,currency",
    );
    expect(INVOICE_CSV_COLUMNS.join(",")).toBe(
      "invoice_draft_reference,facility,relationship_reference,period_start,period_end,work_date,worker_reference,worker_name,discipline,priced_minutes,bill_rate_minor,bill_amount_minor,currency",
    );
    expect(INVOICE_CSV_COLUMNS.some((column) => column.includes("pay"))).toBe(false);
  });

  it("labels and safe names", () => {
    expect(attentionLabel("ADJUSTMENT_REQUIRED")).toBe("Adjustment required");
    expect(attentionLabel(null)).toBeNull();
    expect(financialStatusTone("exported")).toBe("success");
    expect(financialStatusTone("cancelled")).toBe("neutral");
    expect(safeExportFileName("INV-DRAFT-2026-000001-DRAFT-INVOICE.pdf")).not.toBeNull();
    expect(shortChecksum("a".repeat(64))).toBe("aaaaaaaa…aaaaaaaa");
  });
});
