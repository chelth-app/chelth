import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DataTableRegion } from "@/components/ui/data-table";
import { InlineActionForm } from "@/components/forms/inline-action-form";
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
const TH = "px-3 py-2 font-medium";
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
      <header className="flex flex-col gap-2">
        <Link href={base} className="w-fit text-sm text-primary underline underline-offset-4">
          Payroll
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{batch.reference}</h1>
          <PayrollStatusBadge status={batch.status} />
          <AttentionBadge code={batch.attention} />
        </div>
        <p className="text-sm text-muted-foreground">
          {PAYROLL_PERIOD_TYPE_LABELS[batch.periodType]} period{" "}
          {formatPeriod(batch.periodStart, batch.periodEnd)} · {batch.currency} · Payroll
          preparation only — no payment, tax or deductions.
        </p>
      </header>

      {needsStepUp ? (
        <StepUpNotice returnTo={`${base}/${batch.id}`}>
          Approving, locking and exporting payroll requires verification with your authenticator
          app.
        </StepUpNotice>
      ) : null}

      {batch.attention === "ADJUSTMENT_REQUIRED" ? (
        <p role="status" className="rounded-md border border-border bg-warning-soft p-3 text-sm">
          Adjustment required: some work in this locked batch was revised after it was prepared.
          This batch stays exactly as approved; record the difference as an adjustment.
        </p>
      ) : null}
      {blocked ? (
        <p role="alert" className="rounded-md border border-border bg-danger-soft p-3 text-sm">
          Some work in this batch was revised after it was prepared, so it cannot be approved or
          locked. Cancel the batch and prepare the period again.
        </p>
      ) : null}

      <section aria-labelledby="batch-totals-heading" className="flex flex-col gap-3">
        <h2 id="batch-totals-heading" className="text-lg font-semibold">
          Totals
        </h2>
        <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
          <dt className="text-muted-foreground">Pay total</dt>
          <dd className="font-semibold tabular-nums">
            {formatMoney(batch.totalPayMinor, batch.currency)}
          </dd>
          <dt className="text-muted-foreground">Workers</dt>
          <dd className="tabular-nums">{batch.workerCount}</dd>
          <dt className="text-muted-foreground">Lines</dt>
          <dd className="tabular-nums">{batch.lineCount}</dd>
          <dt className="text-muted-foreground">Regular time</dt>
          <dd className="tabular-nums">{formatWorkedMinutes(batch.totalRegularMinutes)}</dd>
          <dt className="text-muted-foreground">Overtime</dt>
          <dd className="tabular-nums">{formatWorkedMinutes(batch.totalOvertimeMinutes)}</dd>
        </dl>
      </section>

      {batch.status !== "cancelled" ? (
        <section aria-labelledby="batch-steps-heading" className="flex flex-col gap-3">
          <h2 id="batch-steps-heading" className="text-lg font-semibold">
            Next step
          </h2>
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
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          Cancelled by {batch.cancelledByName ?? "a former member"}: “{batch.cancelReason}”. Its
          work was released for a new batch.
        </p>
      )}

      <section aria-labelledby="batch-exports-heading" className="flex flex-col gap-3">
        <h2 id="batch-exports-heading" className="text-lg font-semibold">
          Exports
        </h2>
        <ExportsTable
          rows={exports}
          canDownload={exportCap === "granted"}
          label="Payroll exports"
        />
      </section>

      <section aria-labelledby="batch-workers-heading" className="flex flex-col gap-3">
        <h2 id="batch-workers-heading" className="text-lg font-semibold">
          Worker totals
        </h2>
        <DataTableRegion aria-label="Worker totals table">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
              <tr>
                <th scope="col" className={TH}>
                  Worker
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Lines
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Regular
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Overtime
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Pay
                </th>
              </tr>
            </thead>
            <tbody>
              {workers.map((worker) => (
                <tr key={worker.agencyWorkerId} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-medium">{worker.workerName}</div>
                    {worker.workerReference ? (
                      <div className="text-xs text-muted-foreground">{worker.workerReference}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{worker.lineCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatWorkedMinutes(worker.regularMinutes)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatWorkedMinutes(worker.overtimeMinutes)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(worker.totalPayMinor, batch.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableRegion>
      </section>

      <section aria-labelledby="batch-lines-heading" className="flex flex-col gap-3">
        <h2 id="batch-lines-heading" className="text-lg font-semibold">
          Lines
        </h2>
        <DataTableRegion aria-label="Payroll lines">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
              <tr>
                <th scope="col" className={TH}>
                  Date
                </th>
                <th scope="col" className={TH}>
                  Worker
                </th>
                <th scope="col" className={TH}>
                  Facility · discipline
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Regular
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Overtime
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Pay rate
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Pay
                </th>
                <th scope="col" className={TH}>
                  Source
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr
                  key={line.lineNumber}
                  className="border-b border-border align-top last:border-0"
                >
                  <td className="px-3 py-2">
                    {dateFormat.format(new Date(`${line.workDate}T00:00:00Z`))}
                  </td>
                  <td className="px-3 py-2">{line.workerName}</td>
                  <td className="px-3 py-2">
                    {line.facilityName} · {line.disciplineName}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatWorkedMinutes(line.regularMinutes)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatWorkedMinutes(line.overtimeMinutes)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatHourlyRate(line.payRateMinor, batch.currency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(line.payAmountMinor, batch.currency)}
                  </td>
                  <td className="px-3 py-2 text-xs">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableRegion>
      </section>

      <section aria-labelledby="batch-history-heading" className="flex flex-col gap-3">
        <h2 id="batch-history-heading" className="text-lg font-semibold">
          History
        </h2>
        <HistoryList rows={history} label="Payroll batch history" />
      </section>
    </>
  );
}
