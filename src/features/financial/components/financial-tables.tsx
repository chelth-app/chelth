import type { Route } from "next";
import Link from "next/link";

import { DataTableRegion } from "@/components/ui/data-table";
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

const TH = "px-3 py-2 font-medium";

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
    return <p className="text-sm text-muted-foreground">No exports have been generated yet.</p>;
  }
  return (
    <DataTableRegion aria-label={label}>
      <table className="w-full min-w-[880px] text-left text-sm">
        <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
          <tr>
            <th scope="col" className={TH}>
              File
            </th>
            <th scope="col" className={TH}>
              Generated
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Rows
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Total
            </th>
            <th scope="col" className={TH}>
              SHA-256
            </th>
            <th scope="col" className={TH}>
              Source status
            </th>
            <th scope="col" className={TH}>
              <span className="sr-only">Download</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border align-top last:border-0">
              <td className="px-3 py-2">
                <div className="font-medium">{row.fileName}</div>
                <div className="text-xs text-muted-foreground">
                  {row.format.toUpperCase()} · format v{row.exportVersion} · export{" "}
                  {row.exportNumber} · {formatByteSize(row.byteSize)}
                </div>
              </td>
              <td className="px-3 py-2">
                <div>{when.format(new Date(row.generatedAt))}</div>
                <div className="text-xs text-muted-foreground">
                  by {row.generatedByName ?? "a former member"}
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{row.rowCount}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {signedTotals
                  ? formatSignedMoney(row.totalMinor, row.currency)
                  : formatMoney(row.totalMinor, row.currency)}
              </td>
              <td className="px-3 py-2">
                <code className="font-mono text-xs" title={row.sha256}>
                  {shortChecksum(row.sha256)}
                </code>
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">Full checksum</summary>
                  <code className="font-mono break-all">{row.sha256}</code>
                </details>
              </td>
              <td className="px-3 py-2">
                <div className="text-xs text-muted-foreground">
                  At export: {row.sourceStatusAtExport}
                </div>
                <div className="text-xs text-muted-foreground">Now: {row.sourceStatusNow}</div>
                <AttentionBadge code={row.sourceAttention} />
              </td>
              <td className="px-3 py-2">
                {canDownload ? (
                  <form method="post" action={`/app/exports/${row.id}/download`}>
                    <button
                      type="submit"
                      className="text-sm text-primary underline underline-offset-4"
                      aria-label={`Download ${row.fileName} (export ${row.exportNumber})`}
                    >
                      Download
                    </button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

export function HistoryList({ rows, label }: { rows: DocumentHistoryRow[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col gap-2 text-sm">
      {rows.map((row, index) => (
        <li key={`${row.occurredAt}-${index}`} className="flex flex-wrap gap-x-2">
          <span className="font-medium">{HISTORY_LABELS[row.action] ?? row.action}</span>
          <span className="text-muted-foreground">
            {when.format(new Date(row.occurredAt))} · {row.actorName ?? "a former member"}
          </span>
          {row.note ? <span className="w-full text-muted-foreground">“{row.note}”</span> : null}
        </li>
      ))}
    </ol>
  );
}

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
    return <p className="text-sm text-muted-foreground">No priced work yet.</p>;
  }
  const ordered = [...rows].sort(
    (a, b) =>
      RECONCILIATION_STATES.indexOf(a.state) - RECONCILIATION_STATES.indexOf(b.state) ||
      a.currency.localeCompare(b.currency),
  );
  return (
    <DataTableRegion aria-label={label}>
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
          <tr>
            <th scope="col" className={TH}>
              State
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Lines
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Time
            </th>
            <th scope="col" className={`${TH} text-right`}>
              {amountLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => (
            <tr
              key={`${row.state}-${row.currency}`}
              className="border-b border-border last:border-0"
            >
              <td className="px-3 py-2">{RECONCILIATION_LABELS[row.state] ?? row.state}</td>
              <td className="px-3 py-2 text-right tabular-nums">{row.lineCount}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {DELTA_RECONCILIATION_STATES.includes(row.state)
                  ? formatSignedMinutes(row.minutes)
                  : formatWorkedMinutes(row.minutes)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {!/^[A-Z]{3}$/.test(row.currency)
                  ? "—"
                  : DELTA_RECONCILIATION_STATES.includes(row.state)
                    ? formatSignedMoney(row.amountMinor, row.currency)
                    : formatMoney(row.amountMinor, row.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
          <tr>
            <th scope="col" className={TH}>
              Issue
            </th>
            <th scope="col" className={TH}>
              {showFacility ? "Facility / worker" : "Worker"}
            </th>
            <th scope="col" className={TH}>
              Week
            </th>
            <th scope="col" className={TH}>
              What to do
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`${row.issueCode}-${row.timesheetId ?? row.documentId}-${index}`}
              className="border-b border-border align-top last:border-0"
            >
              <td className="px-3 py-2">
                <AttentionBadge code={row.issueCode} />
              </td>
              <td className="px-3 py-2">
                {[showFacility ? row.facilityName : null, row.workerName]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </td>
              <td className="px-3 py-2">{formatPeriod(row.periodStart, row.periodEnd)}</td>
              <td className="px-3 py-2 text-muted-foreground">
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableRegion>
  );
}
