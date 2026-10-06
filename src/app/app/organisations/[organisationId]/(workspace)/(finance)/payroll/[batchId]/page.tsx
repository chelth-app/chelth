import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { z } from "zod";

import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { InlineActionForm } from "@/components/forms/inline-action-form";
import { RefChip } from "@/components/reference/locked-reference";
import { RecordMeta, RecordNote, RecordPage } from "@/components/reference/record-page";
import { KeyValueList } from "@/components/ui/key-value-list";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SectionTabs } from "@/components/ui/section-tabs";
import {
  CancelPayrollBatchForm,
  ExportsTable,
  getFinancialSettings,
  getPayrollBatch,
  HistoryList,
  listFinancialExports,
  listPayrollBatchHistory,
  listPayrollBatchLines,
  listPayrollBatchWorkers,
  payrollBatchStepAction,
} from "@/features/financial";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";
import {
  attentionLabel,
  PAYROLL_BATCH_STATUS_LABELS,
  PAYROLL_PERIOD_TYPE_LABELS,
} from "@/lib/domain/financial";
import { formatHourlyRate, formatMoney } from "@/lib/domain/pricing";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";

import { LockedNotice } from "../../_components/finance-locked";
import { attentionTone, PAYROLL_TONE } from "../_components/payroll-tones";

export const metadata: Metadata = { title: "Payroll batch" };

const idSchema = z.uuid();
const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});
const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/**
 * One payroll batch: exact totals copied from pricing, worker totals, every
 * line with its source revision, lifecycle steps, exports and history.
 * Canonical record arrangement (Canonical Record Page Primitives). Lifecycle
 * steps keep the existing forms and gates; the database re-checks each one
 * (capability, AAL2, maker-checker).
 */
export default async function PayrollBatchPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/payroll/[batchId]">) {
  const { organisationId: rawOrganisationId, batchId } = await params;
  const context = await loadOrganisationPage(rawOrganisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.PAYROLL_VIEW);
  const { organisationId, can } = context;
  const parsed = idSchema.safeParse(batchId);
  if (!parsed.success) notFound();
  const batch = await getPayrollBatch(parsed.data);
  if (!batch || batch.organisationId !== organisationId) notFound();
  const [workers, lines, exports, history, settings] = await Promise.all([
    listPayrollBatchWorkers(batch.id),
    listPayrollBatchLines(batch.id),
    listFinancialExports("payroll_batch", batch.id),
    listPayrollBatchHistory(batch.id),
    getFinancialSettings(organisationId),
  ]);

  const prepare = can(CAPABILITIES.PAYROLL_PREPARE);
  const approve = can(CAPABILITIES.PAYROLL_APPROVE);
  const exportCap = can(CAPABILITIES.PAYROLL_EXPORT);
  const base = `/app/organisations/${organisationId}/payroll` as const;
  const fields = { organisationId, batchId: batch.id };
  const blocked = batch.attention === "SOURCE_SUPERSEDED";
  const attention = attentionLabel(batch.attention);
  const needsStepUp =
    (["reviewed", "approved"].includes(batch.status) && approve === "step_up_required") ||
    (["locked", "exported"].includes(batch.status) && exportCap === "step_up_required");

  const sections = [
    { label: "Summary", href: "#batch-summary-heading" as Route, current: true },
    ...(batch.status !== "cancelled"
      ? [{ label: "Next Step", href: "#batch-steps-heading" as Route, current: false }]
      : []),
    { label: "Exports", href: "#batch-exports-heading" as Route, current: false },
    { label: "Workers", href: "#batch-workers-heading" as Route, current: false },
    { label: "Lines", href: "#batch-lines-heading" as Route, current: false },
    { label: "History", href: "#batch-history-heading" as Route, current: false },
  ];
  const step = (at: string | null, by: string | null) =>
    at ? `${when.format(new Date(at))} · ${by ?? "a former member"}` : "—";

  return (
    // Locked inner-page system (docs/ui-reference/CHELTH-LOCKED-VISUAL-SYSTEM.md).
    <RecordPage>
      <PageHeader
        variant="reference"
        title={batch.reference}
        back={
          <Link href={base} className="text-primary underline underline-offset-4">
            Payroll
          </Link>
        }
        description={
          <p>
            {PAYROLL_PERIOD_TYPE_LABELS[batch.periodType]} period{" "}
            {formatPeriod(batch.periodStart, batch.periodEnd)} · {batch.currency}
          </p>
        }
        meta={
          <>
            <RefChip tone={PAYROLL_TONE[batch.status]} className="font-semibold">
              {PAYROLL_BATCH_STATUS_LABELS[batch.status]}
            </RefChip>
            {attention && batch.attention ? (
              <RefChip tone={attentionTone(batch.attention)} className="font-semibold">
                {attention}
              </RefChip>
            ) : null}
            <RecordMeta>Payroll preparation only — no payment, tax or deductions</RecordMeta>
          </>
        }
      />

      <SectionTabs label="Payroll batch sections" tabs={sections} />

      {needsStepUp ? (
        <StepUpNotice returnTo={`${base}/${batch.id}`}>
          Approving, locking and exporting payroll requires verification with your authenticator
          app.
        </StepUpNotice>
      ) : null}

      {batch.attention === "ADJUSTMENT_REQUIRED" ? (
        <LockedNotice tone="warning" title="Adjustment required" role="status">
          Some work in this locked batch was revised after it was prepared. This batch stays exactly
          as approved; record the difference as an adjustment.
        </LockedNotice>
      ) : null}
      {blocked ? (
        <LockedNotice tone="danger" title="Includes revised work" role="alert">
          Some work in this batch was revised after it was prepared, so it cannot be approved or
          locked. Cancel the batch and prepare the period again.
        </LockedNotice>
      ) : null}

      <Panel titleId="batch-summary-heading" title={<>Summary</>}>
        <KeyValueList
          aria-label="Batch totals"
          className="max-w-2xl"
          items={[
            {
              label: "Pay total",
              value: (
                <span className="font-semibold tabular-nums">
                  {formatMoney(batch.totalPayMinor, batch.currency)}
                </span>
              ),
            },
            { label: "Workers", value: <span className="tabular-nums">{batch.workerCount}</span> },
            { label: "Lines", value: <span className="tabular-nums">{batch.lineCount}</span> },
            {
              label: "Regular time",
              value: (
                <span className="tabular-nums">
                  {formatWorkedMinutes(batch.totalRegularMinutes)}
                </span>
              ),
            },
            {
              label: "Overtime",
              value: (
                <span className="tabular-nums">
                  {formatWorkedMinutes(batch.totalOvertimeMinutes)}
                </span>
              ),
            },
            { label: "Currency", value: batch.currency },
          ]}
        />
        <KeyValueList
          aria-label="Batch lifecycle"
          className="max-w-2xl"
          items={[
            { label: "Prepared", value: step(batch.createdAt, batch.createdByName) },
            { label: "Reviewed", value: step(batch.reviewedAt, batch.reviewedByName) },
            { label: "Approved", value: step(batch.approvedAt, batch.approvedByName) },
            { label: "Locked", value: step(batch.lockedAt, batch.lockedByName) },
            {
              label: "Exported",
              value: batch.exportedAt ? when.format(new Date(batch.exportedAt)) : "—",
            },
          ]}
        />
        <RecordNote>
          Amounts are copied exactly from pricing and never recalculated. Chelth prepares and
          exports payroll data; it does not pay workers.
        </RecordNote>
      </Panel>

      {batch.status !== "cancelled" ? (
        <Panel titleId="batch-steps-heading" title={<>Next Step</>}>
          {settings.makerCheckerRequired && ["draft", "reviewed"].includes(batch.status) ? (
            <LockedNotice tone="info" title="Second approver required">
              Prepared by {batch.createdByName ?? "a former member"}. Approval must be completed by
              another eligible member.
            </LockedNotice>
          ) : null}
          <div className="flex flex-wrap items-start gap-3">
            {batch.status === "draft" && prepare === "granted" ? (
              <InlineActionForm
                action={payrollBatchStepAction}
                fields={{ ...fields, step: "review" }}
                label="Mark reviewed"
                variant="primary"
              />
            ) : null}
            {batch.status === "reviewed" && approve === "granted" && !blocked ? (
              <InlineActionForm
                action={payrollBatchStepAction}
                fields={{ ...fields, step: "approve" }}
                label="Approve batch"
                variant="primary"
              />
            ) : null}
            {batch.status === "approved" && approve === "granted" && !blocked ? (
              <InlineActionForm
                action={payrollBatchStepAction}
                fields={{ ...fields, step: "lock" }}
                label="Lock batch"
                variant="primary"
              />
            ) : null}
            {["locked", "exported"].includes(batch.status) && exportCap === "granted" ? (
              <InlineActionForm
                action={payrollBatchStepAction}
                fields={{ ...fields, step: "export" }}
                label={batch.status === "locked" ? "Export CSV" : "Export CSV again"}
                variant={batch.status === "locked" ? "primary" : "outline"}
              />
            ) : null}
            {["draft", "reviewed"].includes(batch.status) && prepare === "granted" ? (
              <CancelPayrollBatchForm organisationId={organisationId} batchId={batch.id} />
            ) : null}
            {batch.status === "approved" && approve === "granted" ? (
              <CancelPayrollBatchForm organisationId={organisationId} batchId={batch.id} />
            ) : null}
          </div>
          {["locked", "exported"].includes(batch.status) ? (
            <RecordNote>
              Locked {batch.lockedAt ? when.format(new Date(batch.lockedAt)) : ""} by{" "}
              {batch.lockedByName ?? "a former member"}. A locked batch never changes.
            </RecordNote>
          ) : null}
        </Panel>
      ) : (
        <LockedNotice tone="info" title="Cancelled">
          Cancelled by {batch.cancelledByName ?? "a former member"}: “{batch.cancelReason}”. Its
          work was released for a new batch.
        </LockedNotice>
      )}

      <Panel titleId="batch-exports-heading" title={<>Exports</>}>
        <ExportsTable
          rows={exports}
          canDownload={exportCap === "granted"}
          label="Payroll exports"
        />
        <RecordNote>
          Deterministic CSV files with a SHA-256 checksum, kept in private storage. Downloading is
          recorded.
        </RecordNote>
      </Panel>

      <Panel titleId="batch-workers-heading" title={<>Worker Totals</>}>
        <DataTableRegion aria-label="Worker totals table">
          <DataTable className="min-w-[620px]">
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>Worker</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Lines</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Regular</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Overtime</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Pay</DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {workers.map((worker) => (
                <DataTableRow key={worker.agencyWorkerId}>
                  <DataTableCell>
                    <div className="font-medium text-chelth-navy">{worker.workerName}</div>
                    {worker.workerReference ? (
                      <div className="text-xs text-slate-600">{worker.workerReference}</div>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell numeric>{worker.lineCount}</DataTableCell>
                  <DataTableCell numeric>
                    {formatWorkedMinutes(worker.regularMinutes)}
                  </DataTableCell>
                  <DataTableCell numeric>
                    {formatWorkedMinutes(worker.overtimeMinutes)}
                  </DataTableCell>
                  <DataTableCell numeric>
                    {formatMoney(worker.totalPayMinor, batch.currency)}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
        </DataTableRegion>
      </Panel>

      <Panel titleId="batch-lines-heading" title={<>Lines</>}>
        <DataTableRegion aria-label="Payroll lines">
          <DataTable className="min-w-[900px]">
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>Date</DataTableHeaderCell>
                <DataTableHeaderCell>Worker</DataTableHeaderCell>
                <DataTableHeaderCell>Facility · discipline</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Regular</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Overtime</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Pay rate</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Pay</DataTableHeaderCell>
                <DataTableHeaderCell>Source</DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {lines.map((line) => (
                <DataTableRow key={line.lineNumber}>
                  <DataTableCell>
                    {dateFormat.format(new Date(`${line.workDate}T00:00:00Z`))}
                  </DataTableCell>
                  <DataTableCell>{line.workerName}</DataTableCell>
                  <DataTableCell>
                    {line.facilityName} · {line.disciplineName}
                  </DataTableCell>
                  <DataTableCell numeric>{formatWorkedMinutes(line.regularMinutes)}</DataTableCell>
                  <DataTableCell numeric>{formatWorkedMinutes(line.overtimeMinutes)}</DataTableCell>
                  <DataTableCell numeric>
                    {formatHourlyRate(line.payRateMinor, batch.currency)}
                  </DataTableCell>
                  <DataTableCell numeric>
                    {formatMoney(line.payAmountMinor, batch.currency)}
                  </DataTableCell>
                  <DataTableCell className="text-xs">
                    <Link
                      href={`/app/organisations/${organisationId}/pricing/${line.pricedTimesheetId}`}
                      className="text-primary underline underline-offset-4"
                    >
                      Revision {line.timesheetRevision}
                    </Link>
                    {line.superseded ? (
                      <div className="text-slate-600">Now revision {line.currentRevision}</div>
                    ) : null}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
        </DataTableRegion>
      </Panel>

      <Panel titleId="batch-history-heading" title={<>History</>}>
        <HistoryList rows={history} label="Payroll batch history" />
      </Panel>
    </RecordPage>
  );
}
