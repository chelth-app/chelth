import type { StatusTone } from "@/components/ui/status-chip";
import type { InvoiceDraftStatus } from "@/lib/domain/financial";

export { attentionTone } from "../../payroll/_components/payroll-tones";

/*
 * Invoice draft lifecycle → locked chip tone. The same mapping as the existing
 * InvoiceStatusBadge: only an export is a completed (success) state; voided is
 * neutral. Internal drafts only — no state here means sent or paid.
 */
export const INVOICE_TONE: Record<InvoiceDraftStatus, StatusTone> = {
  draft: "neutral",
  reviewed: "info",
  approved: "info",
  locked: "info",
  exported: "success",
  voided: "neutral",
};

/** The next lifecycle step a draft can take, if any (none once voided). */
export const NEXT_STEP_LABEL: Partial<Record<InvoiceDraftStatus, string>> = {
  draft: "Review Draft",
  reviewed: "Approve Draft",
  approved: "Lock Draft",
  locked: "Export Draft Documents",
};
