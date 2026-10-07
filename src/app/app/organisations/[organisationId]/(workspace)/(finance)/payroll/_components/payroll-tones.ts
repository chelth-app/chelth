import type { StatusTone } from "@/components/ui/status-chip";
import type { PayrollBatchStatus } from "@/lib/domain/financial";

/*
 * Payroll lifecycle → locked chip tone. The same mapping as the existing
 * PayrollStatusBadge (financialStatusTone, with "brand" read as in progress):
 * only an export is a completed (success) state. Preparation and export only —
 * no state here means money moved.
 */
export const PAYROLL_TONE: Record<PayrollBatchStatus, StatusTone> = {
  draft: "neutral",
  reviewed: "info",
  approved: "info",
  locked: "info",
  exported: "success",
  cancelled: "neutral",
};

/** Attention code → locked chip tone (as AttentionBadge). */
export function attentionTone(code: string): StatusTone {
  return code === "REVISION_RESOLVED"
    ? "neutral"
    : code === "ADJUSTMENT_IN_PROGRESS"
      ? "info"
      : code === "ADJUSTMENT_REQUIRED"
        ? "warning"
        : "danger";
}

/** The next lifecycle step a batch can take, if any (no step for cancelled). */
export const NEXT_STEP_LABEL: Partial<Record<PayrollBatchStatus, string>> = {
  draft: "Review Batch",
  reviewed: "Approve Batch",
  approved: "Lock Batch",
  locked: "Export CSV",
};
