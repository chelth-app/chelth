import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Panel } from "@/components/ui/panel";
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
import { Badge } from "@/components/ui/badge";
import { KeyValueList } from "@/components/ui/key-value-list";
import { PageHeader } from "@/components/ui/page-header";
import {
  AttentionBadge,
  CancelPayrollBatchForm,
  ExportsTable,
  getPayrollBatch,
  HistoryList,
  listFinancialExports,
  listPayrollBatchHistory,
  listPayrollBatchLines,
  listPayrollBatchWorkers,
  payrollBatchStepAction,
  PayrollStatusBadge,
} from "@/features/financial";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";
import { PAYROLL_PERIOD_TYPE_LABELS } from "@/lib/domain/financial";
import { formatHourlyRate, formatMoney } from "@/lib/domain/pricing";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";

export const metadata: Metadata = { title: "Payroll batch" };

const idSchema = z.uuid();
const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});

/**
 * One payroll batch: exact totals copied from pricing, worker totals, every
 * line with its source revision, lifecycle steps, exports and history.
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
  const [workers, lines, exports, history] = await Promise.all([
    listPayrollBatchWorkers(batch.id),
    listPayrollBatchLines(batch.id),
    listFinancialExports("payroll_batch", batch.id),
    listPayrollBatchHistory(batch.id),
  ]);

  const prepare = can(CAPABILITIES.PAYROLL_PREPARE);
  const approve = can(CAPABILITIES.PAYROLL_APPROVE);
  const exportCap = can(CAPABILITIES.PAYROLL_EXPORT);
  const base = `/app/organisations/${organisationId}/payroll` as const;
  const fields = { organisationId, batchId: batch.id };
  const blocked = batch.attention === "SOURCE_SUPERSEDED";
  const needsStepUp =
    (["reviewed", "approved"].includes(batch.status) && approve === "step_up_required") ||
    (["locked", "exported"].includes(batch.status) && exportCap === "step_up_required");

  return (
    <>
      <PageHeader
        title={batch.reference}
        back={
          <Link href={base} className="text-primary underline underline-offset-4">
            Payroll
          </Link>
        }
        description={
          <p className="text-sm">
            {PAYROLL_PERIOD_TYPE_LABELS[batch.periodType]} period{" "}
            {formatPeriod(batch.periodStart, batch.periodEnd)} · {batch.currency} · Payroll
            preparation only — no payment, tax or deductions.
          </p>
        }
        meta={
          <>
            <PayrollStatusBadge status={batch.status} />
            <AttentionBadge code={batch.attention} />
            <Badge tone="neutral">{batch.currency}</Badge>
          </>
        }
      />

      {needsStepUp ? (
        <StepUpNotice returnTo={`${base}/${batch.id}`}>
          Approving, locking and exporting payroll requires verification with your authenticator
          app.
        </StepUpNotice>
      ) : null}

      {batch.attention === "ADJUSTMENT_REQUIRED" ? (
        <p
          role="status"
          className="rounded-md border border-border bg-warning-soft p-3 text-sm text-warning-soft-foreground"
        >
          Adjustment required: some work in this locked batch was revised after it was prepared.
          This batch stays exactly as approved; record the difference as an adjustment.
        </p>
      ) : null}
      {blocked ? (
        <p
          role="alert"
          className="rounded-md border border-border bg-danger-soft p-3 text-sm text-danger-soft-foreground"
        >
          Some work in this batch was revised after it was prepared, so it cannot be approved or
          locked. Cancel the batch and prepare the period again.
        </p>
      ) : null}

      <Panel titleId="batch-totals-heading" title={<>Totals</>}>
        <KeyValueList
          aria-label="Batch totals"
          className="max-w-xl"
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
          ]}
        />
      </Panel>

      {batch.status !== "cancelled" ? (
        <Panel titleId="batch-steps-heading" title={<>Next step</>}>
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
            <p className="text-sm text-muted-foreground">
              Locked {batch.lockedAt ? new Date(batch.lockedAt).toLocaleString("en-US") : ""} by{" "}
              {batch.lockedByName ?? "a former member"}. A locked batch never changes.
            </p>
          ) : null}
        </Panel>
      ) : (
        <p className="text-sm text-muted-foreground">
          Cancelled by {batch.cancelledByName ?? "a former member"}: “{batch.cancelReason}”. Its
          work was released for a new batch.
        </p>
      )}

      <Panel titleId="batch-exports-heading" title={<>Exports</>}>
        <ExportsTable
          rows={exports}
          canDownload={exportCap === "granted"}
          label="Payroll exports"
        />
      </Panel>

      <Panel titleId="batch-workers-heading" title={<>Worker totals</>}>
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
                    <div className="font-medium">{worker.workerName}</div>
                    {worker.workerReference ? (
                      <div className="text-xs text-muted-foreground">{worker.workerReference}</div>
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
                      <div className="text-muted-foreground">
                        Now revision {line.currentRevision}
                      </div>
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
    </>
  );
}
