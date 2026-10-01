import { z } from "zod";

import { PAYROLL_PERIOD_TYPES } from "@/lib/domain/financial";
import { SUPPORTED_CURRENCIES } from "@/lib/domain/pricing";

/*
 * Financial actions carry identifiers only: an agency, a period start, a
 * currency, a relationship or a document id. Minutes, rates, amounts and
 * checksums are never accepted from the browser — the database copies them
 * from immutable priced lines.
 */

const organisationId = z.uuid();
const reason = z
  .string()
  .trim()
  .min(1, "Give a reason.")
  .max(500, "Keep the reason under 500 characters.");
const prefix = z
  .string()
  .trim()
  .max(20, "Use at most 20 characters.")
  .regex(/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/, "Use capital letters, digits and single hyphens.");

export const financialSettingsSchema = z.object({
  organisationId,
  payrollPeriodType: z.enum(PAYROLL_PERIOD_TYPES, { error: "Choose a payroll period." }),
  payrollAnchorDate: z.iso.date({ error: "Choose the start date of a payroll period." }),
  payrollReferencePrefix: prefix,
  invoiceReferencePrefix: prefix,
});

export const createPayrollBatchSchema = z.object({
  organisationId,
  periodStart: z.iso.date(),
  currency: z.enum(SUPPORTED_CURRENCIES),
});

export const payrollBatchActionSchema = z.object({
  organisationId,
  batchId: z.uuid(),
  step: z.enum(["review", "approve", "lock", "export"]),
});

export const cancelPayrollBatchSchema = z.object({
  organisationId,
  batchId: z.uuid(),
  reason,
});

export const createInvoiceDraftSchema = z.object({
  organisationId,
  relationshipId: z.uuid(),
  periodStart: z.iso.date(),
  currency: z.enum(SUPPORTED_CURRENCIES),
});

export const invoiceDraftActionSchema = z.object({
  organisationId,
  draftId: z.uuid(),
  step: z.enum(["review", "approve", "lock", "export_csv", "export_pdf"]),
});

export const voidInvoiceDraftSchema = z.object({
  organisationId,
  draftId: z.uuid(),
  reason,
});

export const exportIdSchema = z.uuid();

export const makerCheckerSchema = z.object({
  organisationId,
  required: z.enum(["true", "false"]).transform((value) => value === "true"),
});

// -----------------------------------------------------------------------------
// Adjustments (identifiers only — deltas come from immutable pricing)
// -----------------------------------------------------------------------------

export const createPayrollAdjustmentSchema = z.object({
  organisationId,
  timesheetId: z.uuid(),
});

export const payrollAdjustmentStepSchema = z.object({
  organisationId,
  adjustmentId: z.uuid(),
  step: z.enum(["review", "approve", "lock", "export"]),
});

export const cancelPayrollAdjustmentSchema = z.object({
  organisationId,
  adjustmentId: z.uuid(),
  reason,
});

export const createInvoiceAdjustmentSchema = z.object({
  organisationId,
  timesheetId: z.uuid(),
  relationshipId: z.uuid(),
});

export const invoiceAdjustmentStepSchema = z.object({
  organisationId,
  adjustmentId: z.uuid(),
  step: z.enum(["review", "approve", "lock", "export_csv", "export_pdf"]),
});

export const voidInvoiceAdjustmentSchema = z.object({
  organisationId,
  adjustmentId: z.uuid(),
  reason,
});
