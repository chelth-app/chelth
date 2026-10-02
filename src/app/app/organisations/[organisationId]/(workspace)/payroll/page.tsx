import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DataTableRegion } from "@/components/ui/data-table";
import { InlineActionForm } from "@/components/forms/inline-action-form";
import {
  AttentionBadge,
  createPayrollBatchAction,
  FinancialSettingsForm,
  getFinancialSettings,
  getReconciliation,
  IssuesTable,
  listPayrollBatches,
  listPayrollIssues,
  listPayrollAdjustmentCandidates,
  listPayrollAdjustments,
  listPayrollWork,
  MakerCheckerForm,
  PayrollAdjustmentCandidates,
  PayrollAdjustmentsTable,
  PayrollStatusBadge,
  ReconciliationTable,
} from "@/features/financial";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";
import { formatCalendarDate } from "@/lib/domain/credentials";
import {
  PAYROLL_BATCH_STATUS_LABELS,
  PAYROLL_BATCH_STATUSES,
  PAYROLL_PERIOD_TYPE_LABELS,
} from "@/lib/domain/financial";
import { formatMoney } from "@/lib/domain/pricing";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";

export const metadata: Metadata = { title: "Payroll" };

const TH = "px-3 py-2 font-medium";

/**
 * Payroll PREPARATION: priced work grouped into payroll periods, batches by
 * state and what needs attention first. Chelth does not run payroll, pay
 * workers or calculate tax or deductions.
 */
export default async function PayrollPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/payroll">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.PAYROLL_VIEW);
  const { organisationId, organisation, can } = context;
  if (organisation.type !== "agency") notFound();

  const [settings, work, issues, batches, reconciliation, candidates, adjustments] =
    await Promise.all([
      getFinancialSettings(organisationId),
      listPayrollWork(organisationId),
      listPayrollIssues(organisationId),
      listPayrollBatches(organisationId),
      getReconciliation(organisationId, "pay"),
      listPayrollAdjustmentCandidates(organisationId),
      listPayrollAdjustments(organisationId),
    ]);
  const canPrepare = can(CAPABILITIES.PAYROLL_PREPARE) === "granted";
  const approve = can(CAPABILITIES.PAYROLL_APPROVE);
  const settingsEditable = approve === "granted" && can(CAPABILITIES.INVOICE_APPROVE) === "granted";
  const ready = work.filter((row) => !row.adjustmentRequired);
  const held = work.filter((row) => row.adjustmentRequired);
  const attentionBatches = batches.filter((batch) => batch.attention);
  const counts = PAYROLL_BATCH_STATUSES.map((status) => ({
    status,
    count: batches.filter((batch) => batch.status === status).length,
  })).filter((entry) => entry.count > 0);
  const base = `/app/organisations/${organisationId}/payroll` as const;

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          {organisation.name}
        </Link>
        <h1 className="text-2xl font-semibold">Payroll</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Prepare payroll batches from priced, locked timesheets. Amounts are copied exactly from
          pricing and never recalculated. Chelth prepares and exports payroll data; it does not run
          payroll, pay workers or calculate tax or deductions.
        </p>
        <p className="text-sm text-muted-foreground">
          Payroll periods: {PAYROLL_PERIOD_TYPE_LABELS[settings.payrollPeriodType]}, aligned to{" "}
          {formatCalendarDate(settings.payrollAnchorDate)}.
        </p>
      </header>

      {approve === "step_up_required" ? (
        <StepUpNotice returnTo={base}>
          Approving, locking and exporting payroll requires verification with your authenticator
          app.
        </StepUpNotice>
      ) : null}

      <section aria-labelledby="payroll-attention-heading" className="flex flex-col gap-3">
        <h2 id="payroll-attention-heading" className="text-lg font-semibold">
          Needs attention
        </h2>
        {issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing needs attention.</p>
        ) : (
          <IssuesTable
            rows={issues}
            label="Payroll issues"
            documentHref={(id) => `${base}/${id}`}
            pricingHref={`/app/organisations/${organisationId}/pricing?state=ready`}
            showFacility={false}
          />
        )}
      </section>

      <section aria-labelledby="payroll-adjustments-heading" className="flex flex-col gap-3">
        <h2 id="payroll-adjustments-heading" className="text-lg font-semibold">
          Adjustments
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          When locked work is revised, the original batch never changes. The difference between the
          last accounted revision and the new priced revision is prepared as a separate adjustment.
          An adjustment is not a payment.
        </p>
        <PayrollAdjustmentCandidates
          rows={candidates}
          organisationId={organisationId}
          canPrepare={canPrepare}
        />
        <PayrollAdjustmentsTable rows={adjustments} organisationId={organisationId} />
      </section>

      <section aria-labelledby="payroll-ready-heading" className="flex flex-col gap-3">
        <h2 id="payroll-ready-heading" className="text-lg font-semibold">
          Priced work not yet in a batch
        </h2>
        {ready.length === 0 && held.length === 0 ? (
          <p className="text-sm text-muted-foreground">All priced work is in a batch.</p>
        ) : (
          <DataTableRegion aria-label="Unprepared payroll work">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className={TH}>
                    Payroll period
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Workers
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Lines
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Time
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Pay total
                  </th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...held, ...ready].map((row) => {
                  const period = formatPeriod(row.periodStart, row.periodEnd);
                  return (
                    <tr
                      key={`${row.periodStart}-${row.currency}-${row.adjustmentRequired}`}
                      className="border-b border-border align-top last:border-0"
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{period}</div>
                        <div className="text-xs text-muted-foreground">{row.currency}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.workerCount}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.lineCount}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatWorkedMinutes(row.totalRegularMinutes + row.totalOvertimeMinutes)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(row.totalPayMinor, row.currency)}
                      </td>
                      <td className="px-3 py-2">
                        {row.adjustmentRequired ? (
                          <AttentionBadge code="ADJUSTMENT_REQUIRED" />
                        ) : canPrepare ? (
                          <InlineActionForm
                            action={createPayrollBatchAction}
                            fields={{
                              organisationId,
                              periodStart: row.periodStart,
                              currency: row.currency,
                            }}
                            label="Prepare batch"
                            accessibleLabel={`Prepare payroll batch for ${period} (${row.currency})`}
                            variant="primary"
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataTableRegion>
        )}
      </section>

      <section aria-labelledby="payroll-batches-heading" className="flex flex-col gap-3">
        <h2 id="payroll-batches-heading" className="text-lg font-semibold">
          Payroll batches
        </h2>
        {counts.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {counts
              .map(
                (entry) =>
                  `${entry.count} ${PAYROLL_BATCH_STATUS_LABELS[entry.status].toLowerCase()}`,
              )
              .join(" · ")}
            {attentionBatches.length > 0 ? ` · ${attentionBatches.length} need attention` : ""}
          </p>
        ) : null}
        {batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payroll batches yet.</p>
        ) : (
          <DataTableRegion aria-label="Payroll batches table">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className={TH}>
                    Batch
                  </th>
                  <th scope="col" className={TH}>
                    Period
                  </th>
                  <th scope="col" className={TH}>
                    Status
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Workers
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Pay total
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Exports
                  </th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id} className="border-b border-border align-top last:border-0">
                    <td className="px-3 py-2">
                      <Link
                        href={`${base}/${batch.id}`}
                        className="font-medium text-primary underline underline-offset-4"
                      >
                        {batch.reference}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        Prepared by {batch.createdByName ?? "a former member"}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {formatPeriod(batch.periodStart, batch.periodEnd)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <PayrollStatusBadge status={batch.status} />
                        <AttentionBadge code={batch.attention} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{batch.workerCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(batch.totalPayMinor, batch.currency)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{batch.exportCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTableRegion>
        )}
      </section>

      <section aria-labelledby="payroll-reconciliation-heading" className="flex flex-col gap-3">
        <h2 id="payroll-reconciliation-heading" className="text-lg font-semibold">
          Reconciliation
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Where every current priced pay line stands. Lines in a batch keep the revision they were
          prepared with.
        </p>
        <ReconciliationTable
          rows={reconciliation}
          label="Payroll reconciliation"
          amountLabel="Pay amount"
        />
      </section>

      {settingsEditable ? (
        <section aria-labelledby="payroll-settings-heading" className="flex flex-col gap-3">
          <h2 id="payroll-settings-heading" className="text-lg font-semibold">
            Payroll settings
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Payroll periods are calendar dates. Changing them applies to periods not yet used; a new
            period may not overlap one that already has a batch.
          </p>
          <FinancialSettingsForm
            organisationId={organisationId}
            periodType={settings.payrollPeriodType}
            anchorDate={settings.payrollAnchorDate}
            payrollPrefix={settings.payrollReferencePrefix}
            invoicePrefix={settings.invoiceReferencePrefix}
          />
          <MakerCheckerForm
            organisationId={organisationId}
            required={settings.makerCheckerRequired}
          />
        </section>
      ) : null}
    </>
  );
}
