import type { Route } from "next";
import Link from "next/link";

import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { ActivityTimeline } from "@/components/ui/activity-timeline";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import {
  attentionLabel,
  financialStatusTone,
  formatByteSize,
  formatSignedMinutes,
  formatSignedMoney,
  DELTA_RECONCILIATION_STATES,
  INVOICE_DRAFT_STATUS_LABELS,
  type InvoiceDraftStatus,
  PAYROLL_BATCH_STATUS_LABELS,
  type PayrollBatchStatus,
  RECONCILIATION_LABELS,
  RECONCILIATION_STATES,
  type ReconciliationState,
  shortChecksum,
} from "@/lib/domain/financial";
import { formatMoney } from "@/lib/domain/pricing";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";

import type {
  DocumentHistoryRow,
  FinancialExportRow,
  FinancialIssueRow,
  ReconciliationRow,
} from "../queries";

const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/** Domain tone → shared status tone ("brand" — approved/locked — reads as in progress). */
function chipTone(status: PayrollBatchStatus | InvoiceDraftStatus): StatusTone {
  const tone = financialStatusTone(status);
  return tone === "brand" ? "info" : tone;
}

export function PayrollStatusBadge({ status }: { status: PayrollBatchStatus }) {
  return <StatusChip tone={chipTone(status)}>{PAYROLL_BATCH_STATUS_LABELS[status]}</StatusChip>;
}

export function InvoiceStatusBadge({ status }: { status: InvoiceDraftStatus }) {
  return (
    <StatusChip tone={status === "voided" ? "neutral" : chipTone(status)}>
      {INVOICE_DRAFT_STATUS_LABELS[status]}
    </StatusChip>
  );
}

export function AttentionBadge({ code }: { code: string | null }) {
  const label = attentionLabel(code);
  if (!label) return null;
  const tone =
    code === "REVISION_RESOLVED"
      ? "neutral"
      : code === "ADJUSTMENT_IN_PROGRESS"
        ? "info"
        : code === "ADJUSTMENT_REQUIRED"
          ? "attention"
          : "danger";
  return <StatusChip tone={tone}>{label}</StatusChip>;
}

/** Generated files with their integrity metadata. Downloads are audited POSTs. */
export function ExportsTable({
  rows,
  canDownload,
  label,
  signedTotals = false,
}: {
  rows: FinancialExportRow[];
  canDownload: boolean;
  label: string;
  /** Adjustment exports record a signed net delta. */
  signedTotals?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        headingLevel={3}
        title="No exports have been generated yet."
        description="Exports become available once the document is locked."
      />
    );
  }
  return (
    <DataTableRegion aria-label={label}>
      <DataTable className="min-w-[880px]">
        <DataTableHead>
          <tr>
            <DataTableHeaderCell>File</DataTableHeaderCell>
            <DataTableHeaderCell>Generated</DataTableHeaderCell>
            <DataTableHeaderCell numeric>Rows</DataTableHeaderCell>
            <DataTableHeaderCell numeric>Total</DataTableHeaderCell>
            <DataTableHeaderCell>SHA-256</DataTableHeaderCell>
            <DataTableHeaderCell>Source status</DataTableHeaderCell>
            <DataTableHeaderCell>
              <span className="sr-only">Download</span>
            </DataTableHeaderCell>
          </tr>
        </DataTableHead>
        <tbody>
          {rows.map((row) => (
            <DataTableRow key={row.id}>
              <DataTableCell>
                <div className="font-medium">{row.fileName}</div>
                <div className="text-xs text-muted-foreground">
                  {row.format.toUpperCase()} · format v{row.exportVersion} · export{" "}
                  {row.exportNumber} · {formatByteSize(row.byteSize)}
                </div>
              </DataTableCell>
              <DataTableCell>
                <div>{when.format(new Date(row.generatedAt))}</div>
                <div className="text-xs text-muted-foreground">
                  by {row.generatedByName ?? "a former member"}
                </div>
              </DataTableCell>
              <DataTableCell numeric>{row.rowCount}</DataTableCell>
              <DataTableCell numeric>
                {signedTotals
                  ? formatSignedMoney(row.totalMinor, row.currency)
                  : formatMoney(row.totalMinor, row.currency)}
              </DataTableCell>
              <DataTableCell>
                <code className="font-mono text-xs" title={row.sha256}>
                  {shortChecksum(row.sha256)}
                </code>
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">Full checksum</summary>
                  <code className="font-mono break-all">{row.sha256}</code>
                </details>
              </DataTableCell>
              <DataTableCell>
                <div className="text-xs text-muted-foreground">
                  At export: {row.sourceStatusAtExport}
                </div>
                <div className="text-xs text-muted-foreground">Now: {row.sourceStatusNow}</div>
                <AttentionBadge code={row.sourceAttention} />
              </DataTableCell>
              <DataTableCell>
                {canDownload ? (
                  <form method="post" action={`/app/exports/${row.id}/download`}>
                    <button
                      type="submit"
                      className="inline-flex min-h-11 items-center rounded-md border border-input-border bg-surface px-3 text-sm font-medium text-primary hover:bg-surface-muted"
                      aria-label={`Download ${row.fileName} (export ${row.exportNumber})`}
                    >
                      Download
                    </button>
                  </form>
                ) : null}
              </DataTableCell>
            </DataTableRow>
          ))}
        </tbody>
      </DataTable>
    </DataTableRegion>
  );
}

const HISTORY_LABELS: Record<string, string> = {
  created: "Prepared",
  reviewed: "Marked reviewed",
  returned_to_draft: "Returned to draft",
  approved: "Approved",
  locked: "Locked",
  exported: "Exported",
  cancelled: "Cancelled",
  voided: "Voided",
};

const HISTORY_TONE: Record<string, StatusTone> = {
  created: "neutral",
  reviewed: "info",
  returned_to_draft: "warning",
  approved: "info",
  locked: "success",
  exported: "success",
  cancelled: "neutral",
  voided: "neutral",
};

/** Immutable document history (oldest first), as an activity timeline. */
export function HistoryList({ rows, label }: { rows: DocumentHistoryRow[]; label: string }) {
  return (
    <ActivityTimeline
      label={label}
      items={rows.map((row, index) => ({
        id: `${row.occurredAt}-${index}`,
        tone: HISTORY_TONE[row.action] ?? "neutral",
        title: HISTORY_LABELS[row.action] ?? row.action,
        meta: (
          <>
            {when.format(new Date(row.occurredAt))} · {row.actorName ?? "a former member"}
            {row.note ? <span className="block">“{row.note}”</span> : null}
          </>
        ),
      }))}
    />
  );
}

/** Existing reconciliation vocabulary, visualised; the label is the meaning. */
const RECONCILIATION_TONE: Record<ReconciliationState, StatusTone> = {
  unprepared: "neutral",
  drafted: "info",
  approved: "info",
  exported: "success",
  adjustment_required: "attention",
  adjustment_in_progress: "info",
  adjusted: "success",
};

export function ReconciliationTable({
  rows,
  label,
  amountLabel,
}: {
  rows: ReconciliationRow[];
  label: string;
  amountLabel: string;
}) {
  if (rows.length === 0) {
    return <EmptyState headingLevel={3} title="No priced work yet." />;
  }
  const ordered = [...rows].sort(
    (a, b) =>
      RECONCILIATION_STATES.indexOf(a.state) - RECONCILIATION_STATES.indexOf(b.state) ||
      a.currency.localeCompare(b.currency),
  );
  return (
    <DataTableRegion aria-label={label}>
      <DataTable className="min-w-[520px]">
        <DataTableHead>
          <tr>
            <DataTableHeaderCell>State</DataTableHeaderCell>
            <DataTableHeaderCell numeric>Lines</DataTableHeaderCell>
            <DataTableHeaderCell numeric>Time</DataTableHeaderCell>
            <DataTableHeaderCell numeric>{amountLabel}</DataTableHeaderCell>
          </tr>
        </DataTableHead>
        <tbody>
          {ordered.map((row) => (
            <DataTableRow key={`${row.state}-${row.currency}`}>
              <DataTableCell>
                <StatusChip tone={RECONCILIATION_TONE[row.state] ?? "neutral"}>
                  {RECONCILIATION_LABELS[row.state] ?? row.state}
                </StatusChip>
              </DataTableCell>
              <DataTableCell numeric>{row.lineCount}</DataTableCell>
              <DataTableCell numeric>
                {DELTA_RECONCILIATION_STATES.includes(row.state)
                  ? formatSignedMinutes(row.minutes)
                  : formatWorkedMinutes(row.minutes)}
              </DataTableCell>
              <DataTableCell numeric>
                {!/^[A-Z]{3}$/.test(row.currency)
                  ? "—"
                  : DELTA_RECONCILIATION_STATES.includes(row.state)
                    ? formatSignedMoney(row.amountMinor, row.currency)
                    : formatMoney(row.amountMinor, row.currency)}
              </DataTableCell>
            </DataTableRow>
          ))}
        </tbody>
      </DataTable>
    </DataTableRegion>
  );
}

/** Needs-attention queue shared by payroll and invoices. */
export function IssuesTable({
  rows,
  label,
  documentHref,
  pricingHref,
  showFacility,
}: {
  rows: FinancialIssueRow[];
  label: string;
  documentHref: (id: string) => string;
  pricingHref: string;
  showFacility: boolean;
}) {
  return (
    <DataTableRegion aria-label={label}>
      <DataTable className="min-w-[760px]">
        <DataTableHead>
          <tr>
            <DataTableHeaderCell>Issue</DataTableHeaderCell>
            <DataTableHeaderCell>
              {showFacility ? "Facility / worker" : "Worker"}
            </DataTableHeaderCell>
            <DataTableHeaderCell>Week</DataTableHeaderCell>
            <DataTableHeaderCell>What to do</DataTableHeaderCell>
          </tr>
        </DataTableHead>
        <tbody>
          {rows.map((row, index) => (
            <DataTableRow key={`${row.issueCode}-${row.timesheetId ?? row.documentId}-${index}`}>
              <DataTableCell>
                <AttentionBadge code={row.issueCode} />
              </DataTableCell>
              <DataTableCell>
                {[showFacility ? row.facilityName : null, row.workerName]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </DataTableCell>
              <DataTableCell>{formatPeriod(row.periodStart, row.periodEnd)}</DataTableCell>
              <DataTableCell className="text-muted-foreground">
                {row.issueCode === "ADJUSTMENT_REQUIRED" ? (
                  <>
                    Revision {row.currentRevision} differs from revision {row.preparedRevision} in{" "}
                    {row.documentReferences.join(", ")}. The original stays unchanged; record the
                    difference as an adjustment.
                    {row.newRevisionPriced === false ? " The new revision is not priced yet." : ""}
                  </>
                ) : row.issueCode === "SOURCE_SUPERSEDED" && row.documentId ? (
                  <>
                    <Link
                      href={documentHref(row.documentId) as Route}
                      className="text-primary underline underline-offset-4"
                    >
                      {row.documentReferences.join(", ")}
                    </Link>{" "}
                    includes work that was revised. Cancel it and prepare again.
                  </>
                ) : (
                  <>
                    Locked revision {row.currentRevision} is not priced.{" "}
                    <Link
                      href={pricingHref as Route}
                      className="text-primary underline underline-offset-4"
                    >
                      Open pricing
                    </Link>
                  </>
                )}
              </DataTableCell>
            </DataTableRow>
          ))}
        </tbody>
      </DataTable>
    </DataTableRegion>
  );
}
