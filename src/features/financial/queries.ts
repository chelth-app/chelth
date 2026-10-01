import "server-only";

import type {
  InvoiceDraftStatus,
  PayrollBatchStatus,
  PayrollPeriodType,
  ReconciliationState,
} from "@/lib/domain/financial";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * Reads run as the signed-in user. The projections re-check payroll.view /
 * invoice.view in the database and return integer minor units exactly as
 * stored. Invoice projections carry no pay-side value or margin.
 */

export type FinancialSettings = {
  payrollPeriodType: PayrollPeriodType;
  payrollWeekStartsOn: number;
  payrollAnchorDate: string;
  payrollReferencePrefix: string;
  invoiceReferencePrefix: string;
  configured: boolean;
};

export async function getFinancialSettings(organisationId: string): Promise<FinancialSettings> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_agency_financial_settings", {
    p_organisation_id: organisationId,
  });
  if (error) throw error;
  const row = data[0];
  if (!row) throw new Error("financial settings unavailable");
  return {
    payrollPeriodType: row.payroll_period_type,
    payrollWeekStartsOn: row.payroll_week_starts_on,
    payrollAnchorDate: row.payroll_anchor_date,
    payrollReferencePrefix: row.payroll_reference_prefix,
    invoiceReferencePrefix: row.invoice_reference_prefix,
    configured: row.configured,
  };
}

// -----------------------------------------------------------------------------
// Payroll
// -----------------------------------------------------------------------------

export type PayrollWorkRow = {
  periodStart: string;
  periodEnd: string;
  currency: string;
  adjustmentRequired: boolean;
  lineCount: number;
  workerCount: number;
  timesheetCount: number;
  totalRegularMinutes: number;
  totalOvertimeMinutes: number;
  totalPayMinor: number;
};

export async function listPayrollWork(organisationId: string): Promise<PayrollWorkRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_payroll_work", {
    p_organisation_id: organisationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    periodStart: row.period_start,
    periodEnd: row.period_end,
    currency: row.currency,
    adjustmentRequired: row.adjustment_required,
    lineCount: row.line_count,
    workerCount: row.worker_count,
    timesheetCount: row.timesheet_count,
    totalRegularMinutes: row.total_regular_minutes,
    totalOvertimeMinutes: row.total_overtime_minutes,
    totalPayMinor: row.total_pay_minor,
  }));
}

export type FinancialIssueRow = {
  issueCode: string;
  timesheetId: string | null;
  documentId: string | null;
  facilityName: string | null;
  workerName: string | null;
  periodStart: string;
  periodEnd: string;
  currentRevision: number | null;
  preparedRevision: number | null;
  newRevisionPriced: boolean | null;
  documentReferences: string[];
};

export async function listPayrollIssues(organisationId: string): Promise<FinancialIssueRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_payroll_issues", {
    p_organisation_id: organisationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    issueCode: row.issue_code,
    timesheetId: row.timesheet_id ?? null,
    documentId: row.payroll_batch_id ?? null,
    facilityName: null,
    workerName: row.worker_name ?? null,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    currentRevision: row.current_revision ?? null,
    preparedRevision: row.prepared_revision ?? null,
    newRevisionPriced: row.new_revision_priced ?? null,
    documentReferences: row.document_references ?? [],
  }));
}

export type PayrollBatchRow = {
  id: string;
  reference: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  status: PayrollBatchStatus;
  lineCount: number;
  workerCount: number;
  totalPayMinor: number;
  createdAt: string;
  createdByName: string | null;
  attention: string | null;
  exportCount: number;
};

export async function listPayrollBatches(organisationId: string): Promise<PayrollBatchRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_payroll_batches", {
    p_organisation_id: organisationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.payroll_batch_id,
    reference: row.reference,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    currency: row.currency,
    status: row.status,
    lineCount: row.line_count,
    workerCount: row.worker_count,
    totalPayMinor: row.total_pay_minor,
    createdAt: row.created_at,
    createdByName: row.created_by_name ?? null,
    attention: row.attention ?? null,
    exportCount: row.export_count,
  }));
}

export type PayrollBatchDetail = {
  id: string;
  organisationId: string;
  reference: string;
  periodType: PayrollPeriodType;
  periodStart: string;
  periodEnd: string;
  currency: string;
  status: PayrollBatchStatus;
  lineCount: number;
  workerCount: number;
  totalRegularMinutes: number;
  totalOvertimeMinutes: number;
  totalPayMinor: number;
  createdAt: string;
  createdByName: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  lockedAt: string | null;
  lockedByName: string | null;
  exportedAt: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
  attention: string | null;
};

/** null when the batch does not exist or is not visible (indistinguishable). */
export async function getPayrollBatch(batchId: string): Promise<PayrollBatchDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_payroll_batch", { p_batch_id: batchId });
  if (error) {
    if (error.code === "CHY06") return null;
    throw error;
  }
  const row = data[0];
  if (!row) return null;
  return {
    id: row.payroll_batch_id,
    organisationId: row.agency_organisation_id,
    reference: row.reference,
    periodType: row.period_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    currency: row.currency,
    status: row.status,
    lineCount: row.line_count,
    workerCount: row.worker_count,
    totalRegularMinutes: row.total_regular_minutes,
    totalOvertimeMinutes: row.total_overtime_minutes,
    totalPayMinor: row.total_pay_minor,
    createdAt: row.created_at,
    createdByName: row.created_by_name ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewedByName: row.reviewed_by_name ?? null,
    approvedAt: row.approved_at ?? null,
    approvedByName: row.approved_by_name ?? null,
    lockedAt: row.locked_at ?? null,
    lockedByName: row.locked_by_name ?? null,
    exportedAt: row.exported_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    cancelledByName: row.cancelled_by_name ?? null,
    cancelReason: row.cancel_reason ?? null,
    attention: row.attention ?? null,
  };
}

export type PayrollLineRow = {
  lineNumber: number;
  workDate: string;
  workerReference: string | null;
  workerName: string;
  facilityName: string;
  disciplineName: string;
  regularMinutes: number;
  overtimeMinutes: number;
  payRateMinor: number;
  payAmountMinor: number;
  pricedTimesheetId: string;
  timesheetRevision: number;
  currentRevision: number;
  superseded: boolean;
};

export async function listPayrollBatchLines(batchId: string): Promise<PayrollLineRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_payroll_batch_lines", { p_batch_id: batchId });
  if (error) throw error;
  return data.map((row) => ({
    lineNumber: row.line_number,
    workDate: row.work_date,
    workerReference: row.worker_reference ?? null,
    workerName: row.worker_name,
    facilityName: row.facility_name,
    disciplineName: row.discipline_name,
    regularMinutes: row.regular_minutes,
    overtimeMinutes: row.overtime_minutes,
    payRateMinor: row.pay_rate_minor,
    payAmountMinor: row.pay_amount_minor,
    pricedTimesheetId: row.priced_timesheet_id,
    timesheetRevision: row.timesheet_revision,
    currentRevision: row.current_revision,
    superseded: row.superseded,
  }));
}

export type PayrollWorkerTotalRow = {
  agencyWorkerId: string;
  workerReference: string | null;
  workerName: string;
  lineCount: number;
  regularMinutes: number;
  overtimeMinutes: number;
  totalPayMinor: number;
};

export async function listPayrollBatchWorkers(batchId: string): Promise<PayrollWorkerTotalRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_payroll_batch_workers", {
    p_batch_id: batchId,
  });
  if (error) throw error;
  return data.map((row) => ({
    agencyWorkerId: row.agency_worker_id,
    workerReference: row.worker_reference ?? null,
    workerName: row.worker_name,
    lineCount: row.line_count,
    regularMinutes: row.regular_minutes,
    overtimeMinutes: row.overtime_minutes,
    totalPayMinor: row.total_pay_minor,
  }));
}

export type DocumentHistoryRow = {
  action: string;
  fromStatus: string | null;
  toStatus: string;
  actorName: string | null;
  note: string | null;
  occurredAt: string;
};

export async function listPayrollBatchHistory(batchId: string): Promise<DocumentHistoryRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_payroll_batch_history", {
    p_batch_id: batchId,
  });
  if (error) throw error;
  return data.map((row) => ({
    action: row.action,
    fromStatus: row.from_status ?? null,
    toStatus: row.to_status,
    actorName: row.actor_name ?? null,
    note: row.note ?? null,
    occurredAt: row.occurred_at,
  }));
}

// -----------------------------------------------------------------------------
// Invoices (bill side only)
// -----------------------------------------------------------------------------

export type BillableWorkRow = {
  relationshipId: string;
  facilityId: string;
  facilityName: string;
  relationshipStatus: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  adjustmentRequired: boolean;
  lineCount: number;
  workerCount: number;
  totalPricedMinutes: number;
  totalBillMinor: number;
};

export async function listBillableWork(organisationId: string): Promise<BillableWorkRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_billable_work", {
    p_organisation_id: organisationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    relationshipId: row.relationship_id,
    facilityId: row.agency_facility_id,
    facilityName: row.facility_name,
    relationshipStatus: row.relationship_status,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    currency: row.currency,
    adjustmentRequired: row.adjustment_required,
    lineCount: row.line_count,
    workerCount: row.worker_count,
    totalPricedMinutes: row.total_priced_minutes,
    totalBillMinor: row.total_bill_minor,
  }));
}

export async function listInvoiceIssues(organisationId: string): Promise<FinancialIssueRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_invoice_issues", {
    p_organisation_id: organisationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    issueCode: row.issue_code,
    timesheetId: row.timesheet_id ?? null,
    documentId: row.invoice_draft_id ?? null,
    facilityName: row.facility_name ?? null,
    workerName: row.worker_name ?? null,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    currentRevision: row.current_revision ?? null,
    preparedRevision: row.prepared_revision ?? null,
    newRevisionPriced: row.new_revision_priced ?? null,
    documentReferences: row.document_references ?? [],
  }));
}

export type InvoiceDraftRow = {
  id: string;
  reference: string;
  relationshipId: string;
  facilityName: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  status: InvoiceDraftStatus;
  lineCount: number;
  totalPricedMinutes: number;
  totalBillMinor: number;
  createdAt: string;
  createdByName: string | null;
  attention: string | null;
  exportCount: number;
};

export async function listInvoiceDrafts(organisationId: string): Promise<InvoiceDraftRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_invoice_drafts", {
    p_organisation_id: organisationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.invoice_draft_id,
    reference: row.reference,
    relationshipId: row.relationship_id,
    facilityName: row.facility_name,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    currency: row.currency,
    status: row.status,
    lineCount: row.line_count,
    totalPricedMinutes: row.total_priced_minutes,
    totalBillMinor: row.total_bill_minor,
    createdAt: row.created_at,
    createdByName: row.created_by_name ?? null,
    attention: row.attention ?? null,
    exportCount: row.export_count,
  }));
}

export type InvoiceDraftDetail = {
  id: string;
  organisationId: string;
  reference: string;
  relationshipId: string;
  facilityId: string;
  facilityName: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  status: InvoiceDraftStatus;
  lineCount: number;
  totalPricedMinutes: number;
  totalBillMinor: number;
  createdAt: string;
  createdByName: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  lockedAt: string | null;
  lockedByName: string | null;
  exportedAt: string | null;
  voidedAt: string | null;
  voidedByName: string | null;
  voidReason: string | null;
  attention: string | null;
};

export async function getInvoiceDraft(draftId: string): Promise<InvoiceDraftDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_invoice_draft", { p_draft_id: draftId });
  if (error) {
    if (error.code === "CHY07") return null;
    throw error;
  }
  const row = data[0];
  if (!row) return null;
  return {
    id: row.invoice_draft_id,
    organisationId: row.agency_organisation_id,
    reference: row.reference,
    relationshipId: row.relationship_id,
    facilityId: row.agency_facility_id,
    facilityName: row.facility_name,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    currency: row.currency,
    status: row.status,
    lineCount: row.line_count,
    totalPricedMinutes: row.total_priced_minutes,
    totalBillMinor: row.total_bill_minor,
    createdAt: row.created_at,
    createdByName: row.created_by_name ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewedByName: row.reviewed_by_name ?? null,
    approvedAt: row.approved_at ?? null,
    approvedByName: row.approved_by_name ?? null,
    lockedAt: row.locked_at ?? null,
    lockedByName: row.locked_by_name ?? null,
    exportedAt: row.exported_at ?? null,
    voidedAt: row.voided_at ?? null,
    voidedByName: row.voided_by_name ?? null,
    voidReason: row.void_reason ?? null,
    attention: row.attention ?? null,
  };
}

export type InvoiceLineRow = {
  lineNumber: number;
  workDate: string;
  workerReference: string | null;
  workerName: string;
  disciplineName: string;
  pricedMinutes: number;
  billRegularMinutes: number;
  billOvertimeMinutes: number;
  billRateMinor: number;
  billAmountMinor: number;
  timesheetRevision: number;
  currentRevision: number;
  superseded: boolean;
};

export async function listInvoiceDraftLines(draftId: string): Promise<InvoiceLineRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_invoice_draft_lines", { p_draft_id: draftId });
  if (error) throw error;
  return data.map((row) => ({
    lineNumber: row.line_number,
    workDate: row.work_date,
    workerReference: row.worker_reference ?? null,
    workerName: row.worker_name,
    disciplineName: row.discipline_name,
    pricedMinutes: row.priced_minutes,
    billRegularMinutes: row.bill_regular_minutes,
    billOvertimeMinutes: row.bill_overtime_minutes,
    billRateMinor: row.bill_rate_minor,
    billAmountMinor: row.bill_amount_minor,
    timesheetRevision: row.timesheet_revision,
    currentRevision: row.current_revision,
    superseded: row.superseded,
  }));
}

export async function listInvoiceDraftHistory(draftId: string): Promise<DocumentHistoryRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_invoice_draft_history", {
    p_draft_id: draftId,
  });
  if (error) throw error;
  return data.map((row) => ({
    action: row.action,
    fromStatus: row.from_status ?? null,
    toStatus: row.to_status,
    actorName: row.actor_name ?? null,
    note: row.note ?? null,
    occurredAt: row.occurred_at,
  }));
}

// -----------------------------------------------------------------------------
// Exports and reconciliation
// -----------------------------------------------------------------------------

export type FinancialExportRow = {
  id: string;
  sourceReference: string;
  sourceStatusAtExport: string;
  sourceStatusNow: string;
  sourceAttention: string | null;
  format: "csv" | "pdf";
  exportVersion: number;
  exportNumber: number;
  fileName: string;
  rowCount: number;
  totalMinor: number;
  currency: string;
  sha256: string;
  byteSize: number;
  fileRef: string;
  generatedAt: string;
  generatedByName: string | null;
};

export async function listFinancialExports(
  sourceType: "payroll_batch" | "invoice_draft",
  sourceId: string,
): Promise<FinancialExportRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_financial_exports", {
    p_source_type: sourceType,
    p_source_id: sourceId,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.financial_export_id,
    sourceReference: row.source_reference,
    sourceStatusAtExport: row.source_status_at_export,
    sourceStatusNow: row.source_status_now,
    sourceAttention: row.source_attention ?? null,
    format: row.format === "pdf" ? "pdf" : "csv",
    exportVersion: row.export_version,
    exportNumber: row.export_number,
    fileName: row.file_name,
    rowCount: row.row_count,
    totalMinor: row.total_minor,
    currency: row.currency,
    sha256: row.sha256,
    byteSize: row.byte_size,
    fileRef: row.file_ref,
    generatedAt: row.generated_at,
    generatedByName: row.generated_by_name ?? null,
  }));
}

export type ReconciliationRow = {
  state: ReconciliationState;
  currency: string;
  lineCount: number;
  amountMinor: number;
  minutes: number;
};

export async function getReconciliation(
  organisationId: string,
  side: "pay" | "bill",
): Promise<ReconciliationRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("financial_reconciliation", {
    p_organisation_id: organisationId,
    p_side: side,
  });
  if (error) throw error;
  return data.map((row) => ({
    state: row.state as ReconciliationState,
    currency: row.currency,
    lineCount: row.line_count,
    amountMinor: row.amount_minor,
    minutes: row.minutes,
  }));
}
