import "server-only";

import type { InvoiceDraftStatus, PayrollBatchStatus } from "@/lib/domain/financial";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * Adjustment reads (P0-E7-S3) run as the signed-in user; the projections
 * re-check payroll.view / invoice.view. Amounts are signed integer minor
 * units exactly as stored. Invoice projections carry no pay value or margin.
 */

export type PayrollAdjustmentCandidate = {
  timesheetId: string;
  workerName: string;
  periodStart: string;
  periodEnd: string;
  state: string;
  originalBatchId: string | null;
  originalBatchReference: string | null;
  baseReference: string | null;
  baseRevision: number | null;
  currentRevision: number;
  currentPriced: boolean;
  currency: string | null;
  changedLines: number;
  netDeltaMinor: number | null;
  openAdjustmentId: string | null;
  openAdjustmentReference: string | null;
};

export async function listPayrollAdjustmentCandidates(
  organisationId: string,
): Promise<PayrollAdjustmentCandidate[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_payroll_adjustment_candidates", {
    p_organisation_id: organisationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    timesheetId: row.timesheet_id,
    workerName: row.worker_name,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    state: row.state,
    originalBatchId: row.original_batch_id ?? null,
    originalBatchReference: row.original_batch_reference ?? null,
    baseReference: row.base_reference ?? null,
    baseRevision: row.base_revision ?? null,
    currentRevision: row.current_revision,
    currentPriced: row.current_priced,
    currency: row.currency ?? null,
    changedLines: row.changed_lines,
    netDeltaMinor: row.net_delta_minor ?? null,
    openAdjustmentId: row.open_adjustment_id ?? null,
    openAdjustmentReference: row.open_adjustment_reference ?? null,
  }));
}

export type PayrollAdjustmentRow = {
  id: string;
  reference: string;
  workerName: string;
  periodStart: string;
  periodEnd: string;
  fromRevision: number;
  toRevision: number;
  originalBatchReference: string;
  status: PayrollBatchStatus;
  currency: string;
  lineCount: number;
  netDeltaMinor: number;
  createdAt: string;
  createdByName: string | null;
  attention: string | null;
  exportCount: number;
};

export async function listPayrollAdjustments(
  organisationId: string,
): Promise<PayrollAdjustmentRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_payroll_adjustments", {
    p_organisation_id: organisationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.payroll_adjustment_id,
    reference: row.reference,
    workerName: row.worker_name,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    fromRevision: row.from_revision,
    toRevision: row.to_revision,
    originalBatchReference: row.original_batch_reference,
    status: row.status,
    currency: row.currency,
    lineCount: row.line_count,
    netDeltaMinor: row.net_delta_minor,
    createdAt: row.created_at,
    createdByName: row.created_by_name ?? null,
    attention: row.attention ?? null,
    exportCount: row.export_count,
  }));
}

export type PayrollAdjustmentDetail = {
  id: string;
  organisationId: string;
  reference: string;
  status: PayrollBatchStatus;
  timesheetId: string;
  workerName: string;
  workerReference: string | null;
  periodStart: string;
  periodEnd: string;
  fromRevision: number;
  toRevision: number;
  currentRevision: number;
  fromPricedTimesheetId: string;
  toPricedTimesheetId: string;
  originalBatchId: string;
  originalBatchReference: string;
  previousAdjustmentId: string | null;
  previousAdjustmentReference: string | null;
  currency: string;
  lineCount: number;
  deltaRegularMinutes: number;
  deltaOvertimeMinutes: number;
  totalIncreaseMinor: number;
  totalDecreaseMinor: number;
  netDeltaMinor: number;
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
  preparedByMe: boolean;
};

export async function getPayrollAdjustment(id: string): Promise<PayrollAdjustmentDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_payroll_adjustment", { p_adjustment_id: id });
  if (error) {
    if (error.code === "CHY19") return null;
    throw error;
  }
  const row = data[0];
  if (!row) return null;
  return {
    id: row.payroll_adjustment_id,
    organisationId: row.agency_organisation_id,
    reference: row.reference,
    status: row.status,
    timesheetId: row.timesheet_id,
    workerName: row.worker_name,
    workerReference: row.worker_reference ?? null,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    fromRevision: row.from_revision,
    toRevision: row.to_revision,
    currentRevision: row.current_revision,
    fromPricedTimesheetId: row.from_priced_timesheet_id,
    toPricedTimesheetId: row.to_priced_timesheet_id,
    originalBatchId: row.original_batch_id,
    originalBatchReference: row.original_batch_reference,
    previousAdjustmentId: row.previous_adjustment_id ?? null,
    previousAdjustmentReference: row.previous_adjustment_reference ?? null,
    currency: row.currency,
    lineCount: row.line_count,
    deltaRegularMinutes: row.delta_regular_minutes,
    deltaOvertimeMinutes: row.delta_overtime_minutes,
    totalIncreaseMinor: row.total_increase_minor,
    totalDecreaseMinor: row.total_decrease_minor,
    netDeltaMinor: row.net_delta_minor,
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
    preparedByMe: row.prepared_by_me,
  };
}

export type PayrollAdjustmentLine = {
  lineNumber: number;
  workDate: string;
  facilityName: string;
  disciplineName: string;
  oldRegularMinutes: number | null;
  newRegularMinutes: number | null;
  oldOvertimeMinutes: number | null;
  newOvertimeMinutes: number | null;
  oldPayRateMinor: number | null;
  newPayRateMinor: number | null;
  oldPayAmountMinor: number | null;
  newPayAmountMinor: number | null;
  deltaRegularMinutes: number;
  deltaOvertimeMinutes: number;
  deltaPayAmountMinor: number;
};

export async function listPayrollAdjustmentLines(id: string): Promise<PayrollAdjustmentLine[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_payroll_adjustment_lines", {
    p_adjustment_id: id,
  });
  if (error) throw error;
  return data.map((row) => ({
    lineNumber: row.line_number,
    workDate: row.work_date,
    facilityName: row.facility_name,
    disciplineName: row.discipline_name,
    oldRegularMinutes: row.old_regular_minutes ?? null,
    newRegularMinutes: row.new_regular_minutes ?? null,
    oldOvertimeMinutes: row.old_overtime_minutes ?? null,
    newOvertimeMinutes: row.new_overtime_minutes ?? null,
    oldPayRateMinor: row.old_pay_rate_minor ?? null,
    newPayRateMinor: row.new_pay_rate_minor ?? null,
    oldPayAmountMinor: row.old_pay_amount_minor ?? null,
    newPayAmountMinor: row.new_pay_amount_minor ?? null,
    deltaRegularMinutes: row.delta_regular_minutes,
    deltaOvertimeMinutes: row.delta_overtime_minutes,
    deltaPayAmountMinor: row.delta_pay_amount_minor,
  }));
}

export type AdjustmentHistoryRow = {
  action: string;
  fromStatus: string | null;
  toStatus: string;
  actorName: string | null;
  note: string | null;
  occurredAt: string;
};

export async function listPayrollAdjustmentHistory(id: string): Promise<AdjustmentHistoryRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_payroll_adjustment_history", {
    p_adjustment_id: id,
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
// Invoice adjustments (bill side only)
// -----------------------------------------------------------------------------

export type InvoiceAdjustmentCandidate = {
  timesheetId: string;
  relationshipId: string;
  facilityName: string;
  workerName: string;
  periodStart: string;
  periodEnd: string;
  state: string;
  originalDraftId: string | null;
  originalDraftReference: string | null;
  baseReference: string | null;
  baseRevision: number | null;
  currentRevision: number;
  currentPriced: boolean;
  currency: string | null;
  changedLines: number;
  netDeltaMinor: number | null;
  openAdjustmentId: string | null;
  openAdjustmentReference: string | null;
};

export async function listInvoiceAdjustmentCandidates(
  organisationId: string,
): Promise<InvoiceAdjustmentCandidate[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_invoice_adjustment_candidates", {
    p_organisation_id: organisationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    timesheetId: row.timesheet_id,
    relationshipId: row.relationship_id,
    facilityName: row.facility_name,
    workerName: row.worker_name,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    state: row.state,
    originalDraftId: row.original_draft_id ?? null,
    originalDraftReference: row.original_draft_reference ?? null,
    baseReference: row.base_reference ?? null,
    baseRevision: row.base_revision ?? null,
    currentRevision: row.current_revision,
    currentPriced: row.current_priced,
    currency: row.currency ?? null,
    changedLines: row.changed_lines,
    netDeltaMinor: row.net_delta_minor ?? null,
    openAdjustmentId: row.open_adjustment_id ?? null,
    openAdjustmentReference: row.open_adjustment_reference ?? null,
  }));
}

export type InvoiceAdjustmentRow = {
  id: string;
  reference: string;
  facilityName: string;
  relationshipId: string;
  periodStart: string;
  periodEnd: string;
  fromRevision: number;
  toRevision: number;
  originalDraftReference: string;
  status: InvoiceDraftStatus;
  direction: string;
  currency: string;
  lineCount: number;
  netDeltaMinor: number;
  createdAt: string;
  createdByName: string | null;
  attention: string | null;
  exportCount: number;
};

export async function listInvoiceAdjustments(
  organisationId: string,
): Promise<InvoiceAdjustmentRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_invoice_adjustments", {
    p_organisation_id: organisationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.invoice_adjustment_id,
    reference: row.reference,
    facilityName: row.facility_name,
    relationshipId: row.relationship_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    fromRevision: row.from_revision,
    toRevision: row.to_revision,
    originalDraftReference: row.original_draft_reference,
    status: row.status,
    direction: row.direction,
    currency: row.currency,
    lineCount: row.line_count,
    netDeltaMinor: row.net_delta_minor,
    createdAt: row.created_at,
    createdByName: row.created_by_name ?? null,
    attention: row.attention ?? null,
    exportCount: row.export_count,
  }));
}

export type InvoiceAdjustmentDetail = {
  id: string;
  organisationId: string;
  reference: string;
  status: InvoiceDraftStatus;
  direction: string;
  timesheetId: string;
  relationshipId: string;
  facilityName: string;
  periodStart: string;
  periodEnd: string;
  fromRevision: number;
  toRevision: number;
  currentRevision: number;
  originalDraftId: string;
  originalDraftReference: string;
  previousAdjustmentId: string | null;
  previousAdjustmentReference: string | null;
  currency: string;
  lineCount: number;
  deltaPricedMinutes: number;
  totalIncreaseMinor: number;
  totalDecreaseMinor: number;
  netDeltaMinor: number;
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
  preparedByMe: boolean;
};

export async function getInvoiceAdjustment(id: string): Promise<InvoiceAdjustmentDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_invoice_adjustment", { p_adjustment_id: id });
  if (error) {
    if (error.code === "CHY19") return null;
    throw error;
  }
  const row = data[0];
  if (!row) return null;
  return {
    id: row.invoice_adjustment_id,
    organisationId: row.agency_organisation_id,
    reference: row.reference,
    status: row.status,
    direction: row.direction,
    timesheetId: row.timesheet_id,
    relationshipId: row.relationship_id,
    facilityName: row.facility_name,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    fromRevision: row.from_revision,
    toRevision: row.to_revision,
    currentRevision: row.current_revision,
    originalDraftId: row.original_draft_id,
    originalDraftReference: row.original_draft_reference,
    previousAdjustmentId: row.previous_adjustment_id ?? null,
    previousAdjustmentReference: row.previous_adjustment_reference ?? null,
    currency: row.currency,
    lineCount: row.line_count,
    deltaPricedMinutes: row.delta_priced_minutes,
    totalIncreaseMinor: row.total_increase_minor,
    totalDecreaseMinor: row.total_decrease_minor,
    netDeltaMinor: row.net_delta_minor,
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
    preparedByMe: row.prepared_by_me,
  };
}

export type InvoiceAdjustmentLine = {
  lineNumber: number;
  workDate: string;
  workerReference: string | null;
  workerName: string;
  disciplineName: string;
  oldPricedMinutes: number | null;
  newPricedMinutes: number | null;
  oldBillRateMinor: number | null;
  newBillRateMinor: number | null;
  oldBillAmountMinor: number | null;
  newBillAmountMinor: number | null;
  deltaPricedMinutes: number;
  deltaBillAmountMinor: number;
};

export async function listInvoiceAdjustmentLines(id: string): Promise<InvoiceAdjustmentLine[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_invoice_adjustment_lines", {
    p_adjustment_id: id,
  });
  if (error) throw error;
  return data.map((row) => ({
    lineNumber: row.line_number,
    workDate: row.work_date,
    workerReference: row.worker_reference ?? null,
    workerName: row.worker_name,
    disciplineName: row.discipline_name,
    oldPricedMinutes: row.old_priced_minutes ?? null,
    newPricedMinutes: row.new_priced_minutes ?? null,
    oldBillRateMinor: row.old_bill_rate_minor ?? null,
    newBillRateMinor: row.new_bill_rate_minor ?? null,
    oldBillAmountMinor: row.old_bill_amount_minor ?? null,
    newBillAmountMinor: row.new_bill_amount_minor ?? null,
    deltaPricedMinutes: row.delta_priced_minutes,
    deltaBillAmountMinor: row.delta_bill_amount_minor,
  }));
}

export async function listInvoiceAdjustmentHistory(id: string): Promise<AdjustmentHistoryRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_invoice_adjustment_history", {
    p_adjustment_id: id,
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
