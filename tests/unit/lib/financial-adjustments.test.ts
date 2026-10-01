import { describe, expect, it } from "vitest";

import { assertNotDenied, denialError } from "@/features/financial/denials";
import {
  createInvoiceAdjustmentSchema,
  createPayrollAdjustmentSchema,
  makerCheckerSchema,
  payrollAdjustmentStepSchema,
} from "@/features/financial/schemas";
import {
  adjustmentStateLabel,
  formatSignedMinutes,
  formatSignedMoney,
  INVOICE_ADJUSTMENT_CSV_COLUMNS,
  invoiceDirectionLabel,
  PAYROLL_ADJUSTMENT_CSV_COLUMNS,
  payDeltaLabel,
} from "@/lib/domain/financial";

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

describe("signed adjustment amounts", () => {
  it("formats exact signed minor units with a text sign (true minus)", () => {
    expect(formatSignedMoney(12000, "USD")).toBe("+$120.00");
    expect(formatSignedMoney(-4550, "USD")).toBe("−$45.50");
    expect(formatSignedMoney(0, "USD")).toBe("$0.00");
    expect(formatSignedMoney(-1, "USD")).toBe("−$0.01");
  });

  it("formats signed minutes", () => {
    expect(formatSignedMinutes(90)).toBe("+1h 30m");
    expect(formatSignedMinutes(-45)).toBe("−45m");
    expect(formatSignedMinutes(0)).toBe("0m");
  });

  it("labels never rely on colour", () => {
    expect(payDeltaLabel(1)).toBe("Increase");
    expect(payDeltaLabel(-1)).toBe("Decrease");
    expect(payDeltaLabel(0)).toBe("No net change");
    expect(invoiceDirectionLabel("additional_charge")).toBe("Additional charge");
    expect(invoiceDirectionLabel("credit")).toBe("Credit");
    expect(adjustmentStateLabel("awaiting_pricing")).toBe("Revision not priced yet");
  });
});

describe("adjustment inputs carry identifiers only", () => {
  it("client-supplied deltas or amounts are dropped", () => {
    const parsed = createPayrollAdjustmentSchema.parse({
      organisationId: ORG,
      timesheetId: ID,
      netDeltaMinor: "-999999",
      fromRevision: "1",
    });
    expect(Object.keys(parsed).sort()).toEqual(["organisationId", "timesheetId"]);
    const invoice = createInvoiceAdjustmentSchema.parse({
      organisationId: ORG,
      timesheetId: ID,
      relationshipId: ID,
      billAmountMinor: "1",
    });
    expect(Object.keys(invoice).sort()).toEqual([
      "organisationId",
      "relationshipId",
      "timesheetId",
    ]);
  });

  it("rejects unknown steps and malformed maker/checker values", () => {
    expect(
      payrollAdjustmentStepSchema.safeParse({ organisationId: ORG, adjustmentId: ID, step: "pay" })
        .success,
    ).toBe(false);
    expect(makerCheckerSchema.parse({ organisationId: ORG, required: "true" }).required).toBe(true);
    expect(makerCheckerSchema.safeParse({ organisationId: ORG, required: "yes" }).success).toBe(
      false,
    );
  });
});

describe("returned refusals map to safe errors", () => {
  it("maps each database reason code", () => {
    expect(denialError("MFA_REQUIRED", "ADJUSTMENT_NOT_FOUND").code).toBe("MFA_REQUIRED");
    expect(denialError("MAKER_CHECKER", "ADJUSTMENT_NOT_FOUND").code).toBe(
      "MAKER_CHECKER_REQUIRED",
    );
    expect(denialError("NOT_PERMITTED", "ADJUSTMENT_NOT_FOUND").code).toBe("FORBIDDEN");
    expect(denialError("NOT_FOUND", "ADJUSTMENT_NOT_FOUND").code).toBe("ADJUSTMENT_NOT_FOUND");
  });

  it("fails closed unless the database said approved", () => {
    expect(() =>
      assertNotDenied([{ outcome: "approved", reason_code: null }], "NOT_FOUND"),
    ).not.toThrow();
    expect(() =>
      assertNotDenied([{ outcome: "denied", reason_code: "MAKER_CHECKER" }], "NOT_FOUND"),
    ).toThrow();
    expect(() => assertNotDenied([], "NOT_FOUND")).toThrow();
    expect(() => assertNotDenied(null, "NOT_FOUND")).toThrow();
  });
});

describe("adjustment export columns", () => {
  it("payroll adjustments show original, revised and delta pay", () => {
    expect(PAYROLL_ADJUSTMENT_CSV_COLUMNS).toContain("delta_pay_amount_minor");
    expect(PAYROLL_ADJUSTMENT_CSV_COLUMNS.some((column) => column.includes("bill"))).toBe(false);
  });

  it("invoice adjustments carry no pay columns", () => {
    expect(INVOICE_ADJUSTMENT_CSV_COLUMNS).toContain("delta_bill_amount_minor");
    expect(INVOICE_ADJUSTMENT_CSV_COLUMNS.some((column) => column.includes("pay"))).toBe(false);
  });
});
