import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import {
  AttentionBadge,
  CancelPayrollAdjustmentForm,
  ExportsTable,
  getFinancialSettings,
  getPayrollAdjustment,
  HistoryList,
  listFinancialExports,
  listPayrollAdjustmentHistory,
  listPayrollAdjustmentLines,
  payrollAdjustmentStepAction,
  PayrollStatusBadge,
  SignedAmount,
} from "@/features/financial";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";
import { formatSignedMinutes, formatSignedMoney } from "@/lib/domain/financial";
import { formatHourlyRate, formatMoney } from "@/lib/domain/pricing";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";

export const metadata: Metadata = { title: "Payroll adjustment" };

const idSchema = z.uuid();
const TABLE_REGION = "relative overflow-x-auto rounded-lg border border-border bg-surface";
const TH = "px-3 py-2 font-medium";
const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});

function pair(before: string, after: string) {
  return before === after ? after : `${before} → ${after}`;
}

/**
 * One payroll adjustment: the delta between the last accounted revision and
 * the new priced revision, as its own immutable document. Not a payment.
 */
export default async function PayrollAdjustmentPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/payroll/adjustments/[adjustmentId]">) {
  const { organisationId: rawOrganisationId, adjustmentId } = await params;
  const context = await loadOrganisationPage(rawOrganisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.PAYROLL_VIEW);
  const { organisationId, can } = context;
  const parsed = idSchema.safeParse(adjustmentId);
  if (!parsed.success) notFound();
  const adjustment = await getPayrollAdjustment(parsed.data);
  if (!adjustment || adjustment.organisationId !== organisationId) notFound();
  const [lines, exports, history, settings] = await Promise.all([
    listPayrollAdjustmentLines(adjustment.id),
    listFinancialExports("payroll_adjustment", adjustment.id),
    listPayrollAdjustmentHistory(adjustment.id),
    getFinancialSettings(organisationId),
  ]);

  const prepare = can(CAPABILITIES.PAYROLL_PREPARE);
  const approve = can(CAPABILITIES.PAYROLL_APPROVE);
  const exportCap = can(CAPABILITIES.PAYROLL_EXPORT);
  const base = `/app/organisations/${organisationId}/payroll` as const;
  const fields = { organisationId, adjustmentId: adjustment.id };
  const blocked = adjustment.attention === "SOURCE_SUPERSEDED";
  const checkerNeeded = settings.makerCheckerRequired && adjustment.preparedByMe;
  const { currency } = adjustment;
  const needsStepUp =
    (["reviewed", "approved"].includes(adjustment.status) && approve === "step_up_required") ||
    (["locked", "exported"].includes(adjustment.status) && exportCap === "step_up_required");

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href={base} className="w-fit text-sm text-primary underline underline-offset-4">
          Payroll
        </Link>
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Adjustment — not payment
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{adjustment.reference}</h1>
          <PayrollStatusBadge status={adjustment.status} />
          <AttentionBadge code={adjustment.attention} />
        </div>
        <p className="text-sm text-muted-foreground">
          {adjustment.workerName} · week{" "}
          {formatPeriod(adjustment.periodStart, adjustment.periodEnd)} · {currency}
        </p>
      </header>

      {needsStepUp ? (
        <StepUpNotice returnTo={`${base}/adjustments/${adjustment.id}`}>
          Approving, locking and exporting payroll adjustments requires verification with your
          authenticator app.
        </StepUpNotice>
      ) : null}
      {blocked ? (
        <p role="alert" className="rounded-md border border-border bg-danger-soft p-3 text-sm">
          The timesheet was revised again after this adjustment was prepared, so it cannot be
          approved or locked. Cancel it and prepare a new adjustment.
        </p>
      ) : null}
      {adjustment.status === "reviewed" && checkerNeeded ? (
        <p role="status" className="rounded-md border border-border bg-info-soft p-3 text-sm">
          You prepared this adjustment. A different finance member must approve it.
        </p>
      ) : null}

      <section aria-labelledby="adjustment-lineage-heading" className="flex flex-col gap-3">
        <h2 id="adjustment-lineage-heading" className="text-lg font-semibold">
          What it adjusts
        </h2>
        <dl className="grid max-w-2xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
          <dt className="text-muted-foreground">Original batch</dt>
          <dd>
            <Link
              href={`${base}/${adjustment.originalBatchId}`}
              className="text-primary underline underline-offset-4"
            >
              {adjustment.originalBatchReference}
            </Link>{" "}
            <span className="text-muted-foreground">(unchanged)</span>
          </dd>
          {adjustment.previousAdjustmentId ? (
            <>
              <dt className="text-muted-foreground">Follows</dt>
              <dd>
                <Link
                  href={`${base}/adjustments/${adjustment.previousAdjustmentId}`}
                  className="text-primary underline underline-offset-4"
                >
                  {adjustment.previousAdjustmentReference}
                </Link>
              </dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Revision change</dt>
          <dd>
            Last accounted revision {adjustment.fromRevision} → priced revision{" "}
            {adjustment.toRevision}
            {adjustment.currentRevision !== adjustment.toRevision ? (
              <span className="text-muted-foreground">
                {" "}
                (timesheet is now at revision {adjustment.currentRevision})
              </span>
            ) : null}
          </dd>
          <dt className="text-muted-foreground">Source pricing</dt>
          <dd>
            <Link
              href={`/app/organisations/${organisationId}/pricing/${adjustment.fromPricedTimesheetId}`}
              className="text-primary underline underline-offset-4"
            >
              Revision {adjustment.fromRevision}
            </Link>{" "}
            ·{" "}
            <Link
              href={`/app/organisations/${organisationId}/pricing/${adjustment.toPricedTimesheetId}`}
              className="text-primary underline underline-offset-4"
            >
              Revision {adjustment.toRevision}
            </Link>
          </dd>
        </dl>
      </section>

      <section aria-labelledby="adjustment-totals-heading" className="flex flex-col gap-3">
        <h2 id="adjustment-totals-heading" className="text-lg font-semibold">
          Net change
        </h2>
        <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
          <dt className="text-muted-foreground">Net pay change</dt>
          <dd>
            <SignedAmount minor={adjustment.netDeltaMinor} currency={currency} side="pay" />
          </dd>
          <dt className="text-muted-foreground">Increases</dt>
          <dd className="tabular-nums">
            {formatSignedMoney(adjustment.totalIncreaseMinor, currency)}
          </dd>
          <dt className="text-muted-foreground">Decreases</dt>
          <dd className="tabular-nums">
            {formatSignedMoney(-adjustment.totalDecreaseMinor, currency)}
          </dd>
          <dt className="text-muted-foreground">Regular time</dt>
          <dd className="tabular-nums">{formatSignedMinutes(adjustment.deltaRegularMinutes)}</dd>
          <dt className="text-muted-foreground">Overtime</dt>
          <dd className="tabular-nums">{formatSignedMinutes(adjustment.deltaOvertimeMinutes)}</dd>
          <dt className="text-muted-foreground">Changed lines</dt>
          <dd className="tabular-nums">{adjustment.lineCount}</dd>
        </dl>
      </section>

      {adjustment.status !== "cancelled" ? (
        <section aria-labelledby="adjustment-steps-heading" className="flex flex-col gap-3">
          <h2 id="adjustment-steps-heading" className="text-lg font-semibold">
            Next step
          </h2>
          <div className="flex flex-wrap items-start gap-3">
            {adjustment.status === "draft" && prepare === "granted" ? (
              <InlineActionForm
                action={payrollAdjustmentStepAction}
                fields={{ ...fields, step: "review" }}
                label="Mark reviewed"
                variant="primary"
              />
            ) : null}
            {adjustment.status === "reviewed" &&
            approve === "granted" &&
            !blocked &&
            !checkerNeeded ? (
              <InlineActionForm
                action={payrollAdjustmentStepAction}
                fields={{ ...fields, step: "approve" }}
                label="Approve adjustment"
                variant="primary"
              />
            ) : null}
            {adjustment.status === "approved" && approve === "granted" && !blocked ? (
              <InlineActionForm
                action={payrollAdjustmentStepAction}
                fields={{ ...fields, step: "lock" }}
                label="Lock adjustment"
                variant="primary"
              />
            ) : null}
            {["locked", "exported"].includes(adjustment.status) && exportCap === "granted" ? (
              <InlineActionForm
                action={payrollAdjustmentStepAction}
                fields={{ ...fields, step: "export" }}
                label={adjustment.status === "locked" ? "Export CSV" : "Export CSV again"}
                variant={adjustment.status === "locked" ? "primary" : "outline"}
              />
            ) : null}
            {(["draft", "reviewed"].includes(adjustment.status) && prepare === "granted") ||
            (adjustment.status === "approved" && approve === "granted") ? (
              <CancelPayrollAdjustmentForm
                organisationId={organisationId}
                adjustmentId={adjustment.id}
              />
            ) : null}
          </div>
          {["locked", "exported"].includes(adjustment.status) ? (
            <p className="text-sm text-muted-foreground">
              Locked by {adjustment.lockedByName ?? "a former member"}. A locked adjustment never
              changes.
            </p>
          ) : null}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          Cancelled by {adjustment.cancelledByName ?? "a former member"}: “{adjustment.cancelReason}
          ”. The revision change can be adjusted again.
        </p>
      )}

      <section aria-labelledby="adjustment-exports-heading" className="flex flex-col gap-3">
        <h2 id="adjustment-exports-heading" className="text-lg font-semibold">
          Exports
        </h2>
        <ExportsTable
          rows={exports}
          canDownload={exportCap === "granted"}
          label="Payroll adjustment exports"
          signedTotals
        />
      </section>

      <section aria-labelledby="adjustment-lines-heading" className="flex flex-col gap-3">
        <h2 id="adjustment-lines-heading" className="text-lg font-semibold">
          Changed lines
        </h2>
        <div
          role="region"
          aria-label="Payroll adjustment lines"
          tabIndex={0}
          className={TABLE_REGION}
        >
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
              <tr>
                <th scope="col" className={TH}>
                  Date
                </th>
                <th scope="col" className={TH}>
                  Facility · discipline
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Time (original → revised)
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Pay rate
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Pay (original → revised)
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Change
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
                  <td className="px-3 py-2">
                    {line.facilityName} · {line.disciplineName}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {pair(
                      line.oldRegularMinutes === null
                        ? "—"
                        : formatWorkedMinutes(
                            (line.oldRegularMinutes ?? 0) + (line.oldOvertimeMinutes ?? 0),
                          ),
                      line.newRegularMinutes === null
                        ? "—"
                        : formatWorkedMinutes(
                            (line.newRegularMinutes ?? 0) + (line.newOvertimeMinutes ?? 0),
                          ),
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {pair(
                      line.oldPayRateMinor === null
                        ? "—"
                        : formatHourlyRate(line.oldPayRateMinor, currency),
                      line.newPayRateMinor === null
                        ? "—"
                        : formatHourlyRate(line.newPayRateMinor, currency),
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {line.oldPayAmountMinor === null
                      ? "—"
                      : formatMoney(line.oldPayAmountMinor, currency)}{" "}
                    →{" "}
                    {line.newPayAmountMinor === null
                      ? "—"
                      : formatMoney(line.newPayAmountMinor, currency)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <SignedAmount minor={line.deltaPayAmountMinor} currency={currency} side="pay" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="adjustment-history-heading" className="flex flex-col gap-3">
        <h2 id="adjustment-history-heading" className="text-lg font-semibold">
          History
        </h2>
        <HistoryList rows={history} label="Payroll adjustment history" />
      </section>
    </>
  );
}
