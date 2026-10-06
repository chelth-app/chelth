import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import {
  KpiNote,
  REF_TABLE,
  REF_TEXT,
  RefChip,
  RefKpiCard,
  RefPanel,
} from "@/components/reference/locked-reference";
import { RecordMeta, RecordNote } from "@/components/reference/record-page";
import { DataTableRegion } from "@/components/ui/data-table";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { PageHeader } from "@/components/ui/page-header";
import {
  createPayrollBatchAction,
  getFinancialSettings,
  getReconciliation,
  IssuesTable,
  listPayrollAdjustmentCandidates,
  listPayrollAdjustments,
  listPayrollBatches,
  listPayrollBatchHistory,
  listPayrollBatchWorkers,
  listPayrollIssues,
  listPayrollWork,
  PayrollAdjustmentCandidates,
  PayrollAdjustmentsTable,
  type PayrollBatchRow,
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
  attentionLabel,
  PAYROLL_BATCH_STATUS_LABELS,
  PAYROLL_BATCH_STATUSES,
  PAYROLL_PERIOD_TYPE_LABELS,
} from "@/lib/domain/financial";
import { formatMoney } from "@/lib/domain/pricing";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";
import { cn } from "@/lib/utils/cn";

import { HeaderAddAction, LockedEmpty, LockedFilterSelect } from "../_components/finance-locked";
import { type BatchDetails, BatchDetailsPanel } from "./_components/batch-details-panel";
import { attentionTone, NEXT_STEP_LABEL, PAYROLL_TONE } from "./_components/payroll-tones";

export const metadata: Metadata = { title: "Payroll" };

/**
 * Drawer details (worker totals and history) are read for at most this many
 * listed batches per view; further rows open the record for them.
 */
const DETAIL_LIMIT = 15;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

/**
 * Payroll PREPARATION (locked finance system, F1 parent): priced work grouped
 * into payroll periods, batches through Draft → Reviewed → Approved → Locked
 * → Exported, adjustments and reconciliation. Amounts are copied from pricing
 * in minor units and never recalculated here. Chelth does not run payroll, pay
 * workers or calculate tax or deductions. Every figure is a count over the
 * loaded records; filters narrow the loaded batches (no new query).
 */
export default async function PayrollPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/payroll">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.PAYROLL_VIEW);
  const { organisationId, can } = context;
  if (context.organisation.type !== "agency") notFound();

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
  const prepare = can(CAPABILITIES.PAYROLL_PREPARE);
  const canPrepare = prepare === "granted";
  const approve = can(CAPABILITIES.PAYROLL_APPROVE);
  const exportCap = can(CAPABILITIES.PAYROLL_EXPORT);
  const settingsEditable = approve === "granted" && can(CAPABILITIES.INVOICE_APPROVE) === "granted";
  const ready = work.filter((row) => !row.adjustmentRequired);
  const held = work.filter((row) => row.adjustmentRequired);

  const raw = await searchParams;
  const statusFilter = PAYROLL_BATCH_STATUSES.find((status) => status === first(raw.status));
  const periods = [...new Set(batches.map((batch) => batch.periodStart))].sort().reverse();
  const periodFilter = periods.find((period) => period === first(raw.period));
  const shownBatches = batches.filter(
    (batch) =>
      (!statusFilter || batch.status === statusFilter) &&
      (!periodFilter || batch.periodStart === periodFilter),
  );
  const loaded = await Promise.all(
    shownBatches.slice(0, DETAIL_LIMIT).map(async (batch) => {
      const [workers, history] = await Promise.all([
        listPayrollBatchWorkers(batch.id),
        listPayrollBatchHistory(batch.id),
      ]);
      return [batch.id, { workers, history }] as const;
    }),
  );
  const details = new Map<string, BatchDetails>(loaded);

  const countOf = (status: (typeof PAYROLL_BATCH_STATUSES)[number]) =>
    batches.filter((batch) => batch.status === status).length;
  const adjustmentsRequired = candidates.filter((row) => row.state === "required").length;
  const readyWorkers = ready.reduce((sum, row) => sum + row.workerCount, 0);
  const base = `/app/organisations/${organisationId}/payroll` as const;
  const hasFilters = Boolean(statusFilter || periodFilter);
  const quick = (status: (typeof PAYROLL_BATCH_STATUSES)[number]) => ({
    href: `${base}?status=${status}` as Route,
    active: statusFilter === status && !periodFilter,
  });
  const recordHref = (batch: PayrollBatchRow) => `${base}/${batch.id}` as Route;
  const nextStep = (batch: PayrollBatchRow) => {
    const blocked = batch.attention === "SOURCE_SUPERSEDED";
    const allowed =
      (batch.status === "draft" && canPrepare) ||
      (batch.status === "reviewed" && approve === "granted" && !blocked) ||
      (batch.status === "approved" && approve === "granted" && !blocked) ||
      (batch.status === "locked" && exportCap === "granted");
    const label = NEXT_STEP_LABEL[batch.status];
    return allowed && label
      ? { label, href: `${recordHref(batch)}#batch-steps-heading` as Route }
      : null;
  };

  return (
    <div className="chelth-locked flex flex-col gap-[13px]">
      <PageHeader
        variant="reference"
        className="xl:mb-1"
        title="Payroll"
        description={
          <p>
            Prepare, review and export payroll batches from priced, approved work. Chelth does not
            pay workers.
          </p>
        }
        meta={
          <>
            <RefChip tone="neutral" className="font-semibold">
              Preparation and export only
            </RefChip>
            <RecordMeta>
              {PAYROLL_PERIOD_TYPE_LABELS[settings.payrollPeriodType]} payroll periods, aligned to{" "}
              {formatCalendarDate(settings.payrollAnchorDate)}
            </RecordMeta>
          </>
        }
        primaryAction={
          canPrepare && ready.length > 0 ? (
            <HeaderAddAction href="#payroll-ready-heading">Prepare Payroll Batch</HeaderAddAction>
          ) : undefined
        }
      />

      {approve === "step_up_required" ? (
        <StepUpNotice returnTo={base}>
          Approving, locking and exporting payroll requires verification with your authenticator
          app.
        </StepUpNotice>
      ) : null}

      {/* Locked: with Payroll Batch Details open on wide screens the work area contracts beside it. */}
      <div className="flex flex-col gap-[13px] min-[1536px]:has-[dialog[open]]:pr-[407px]">
        <section
          aria-label="Payroll summary"
          className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-[13px]"
        >
          <RefKpiCard
            label="Needs Attention"
            value={issues.length}
            supporting="Unpriced or revised work"
            footer={
              <KpiNote tone="warning">
                {adjustmentsRequired === 1
                  ? "1 adjustment required"
                  : `${adjustmentsRequired} adjustments required`}
              </KpiNote>
            }
            glyph="alert"
            icon={<WorkspaceNavIcon name="requests" strokeWidth={2.25} duotone />}
            tone="danger"
            href={`${base}#payroll-attention-heading` as Route}
          />
          <RefKpiCard
            label="Ready to Prepare"
            value={ready.length}
            supporting="Priced periods not in a batch"
            footer={
              <KpiNote tone="info">
                {readyWorkers === 1 ? "1 worker" : `${readyWorkers} workers`}
              </KpiNote>
            }
            glyph="document"
            icon={<WorkspaceNavIcon name="pricing" strokeWidth={2.25} duotone />}
            tone="warning"
            href={`${base}#payroll-ready-heading` as Route}
          />
          <RefKpiCard
            label="Awaiting Approval"
            value={countOf("reviewed")}
            supporting="Batches marked reviewed"
            footer={
              <KpiNote tone="info">
                {countOf("draft")} draft · {countOf("approved")} ready to lock
              </KpiNote>
            }
            glyph="clock"
            icon={<WorkspaceNavIcon name="timesheets" strokeWidth={2.25} duotone />}
            tone="info"
            {...quick("reviewed")}
          />
          <RefKpiCard
            label="Ready to Export"
            value={countOf("locked")}
            supporting="Locked, not exported yet"
            footer={<KpiNote tone="success">{countOf("exported")} exported</KpiNote>}
            glyph="document"
            icon={<WorkspaceNavIcon name="payroll" strokeWidth={2.25} duotone />}
            tone="teal"
            {...quick("locked")}
          />
        </section>

        {batches.length > 0 ? (
          // Locked filter row: each control narrows the loaded batches.
          <form
            key={JSON.stringify([statusFilter, periodFilter])}
            aria-label="Filter payroll batches"
            method="get"
            className="flex flex-wrap items-center gap-[9px]"
          >
            <LockedFilterSelect
              id="batch-period"
              name="period"
              label="Payroll period"
              value={periodFilter ?? ""}
              className="xl:w-[260px]"
              icon={<WorkspaceNavIcon name="shifts" strokeWidth={2.1} />}
            >
              <option value="">All payroll periods</option>
              {periods.map((period) => {
                const batch = batches.find((row) => row.periodStart === period);
                return (
                  <option key={period} value={period}>
                    {batch ? formatPeriod(batch.periodStart, batch.periodEnd) : period}
                  </option>
                );
              })}
            </LockedFilterSelect>
            <LockedFilterSelect
              id="batch-status"
              name="status"
              label="Batch status"
              value={statusFilter ?? ""}
              className="xl:w-[200px]"
            >
              <option value="">All statuses</option>
              {PAYROLL_BATCH_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {PAYROLL_BATCH_STATUS_LABELS[status]}
                </option>
              ))}
            </LockedFilterSelect>
            <button
              type="submit"
              className="inline-flex h-11 items-center rounded-md border border-chelth-border bg-white/90 px-4 text-[13.5px] font-medium text-chelth-navy hover:bg-surface-muted sm:h-[46px]"
            >
              Show
            </button>
            {hasFilters ? (
              <Link
                href={base as Route}
                className="inline-flex min-h-11 items-center px-1 text-[13px] font-medium text-primary underline underline-offset-4"
              >
                Clear filters
              </Link>
            ) : null}
          </form>
        ) : null}

        <RefPanel
          title="Payroll Batches"
          titleId="payroll-batches-heading"
          className="scroll-mt-24"
          action={
            <span className="text-[13.5px] text-muted-foreground">
              {shownBatches.length === 1 ? "1 batch" : `${shownBatches.length} batches`}
            </span>
          }
        >
          {batches.length === 0 ? (
            <LockedEmpty
              icon="payroll"
              title="No payroll batches yet."
              note={
                ready.length > 0
                  ? "Priced, approved work is ready: prepare a batch from it below."
                  : "Approved timesheets are prepared into payroll batches here once they are priced."
              }
            />
          ) : shownBatches.length === 0 ? (
            <LockedEmpty
              icon="payroll"
              title="No payroll batches match these filters."
              note="Change the payroll period or status to see others."
            />
          ) : (
            <DataTableRegion
              aria-label="Payroll batches table"
              className="mt-[9px] rounded-none border-0 bg-transparent"
            >
              <table className={cn(REF_TABLE, "min-w-[900px] table-fixed")}>
                <colgroup>
                  <col className="w-[19%]" />
                  <col className="w-[19%]" />
                  <col className="w-[8%]" />
                  <col className="w-[7%]" />
                  <col className="w-[12%]" />
                  <col className="w-[8%]" />
                  <col className="w-[23%]" />
                  <col className="w-[4%]" />
                </colgroup>
                <thead className={REF_TEXT.tableHead}>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Period</th>
                    <th scope="col">Workers</th>
                    <th scope="col">Lines</th>
                    <th scope="col" className="text-right">
                      Pay Total
                    </th>
                    <th scope="col">Exports</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody className={REF_TEXT.tableBody}>
                  {shownBatches.map((batch) => {
                    const attention = attentionLabel(batch.attention);
                    return (
                      <tr
                        key={batch.id}
                        className="h-[42px] transition-colors hover:bg-surface-muted/50 has-[dialog[open]]:bg-chelth-mint-mist/70 [&:has(dialog[open])>*:first-child]:shadow-[inset_3px_0_0_var(--chelth-teal)]"
                      >
                        <td>
                          <span className="flex flex-col py-1.5">
                            <Link
                              href={recordHref(batch)}
                              className="truncate font-medium text-chelth-navy hover:text-primary hover:underline hover:underline-offset-4"
                            >
                              {batch.reference}
                            </Link>
                            <span className="truncate text-[11px] leading-4 text-muted-foreground">
                              Prepared by {batch.createdByName ?? "a former member"}
                            </span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap">
                          {formatPeriod(batch.periodStart, batch.periodEnd)}
                        </td>
                        <td className="tabular-nums">{batch.workerCount}</td>
                        <td className="tabular-nums">{batch.lineCount}</td>
                        <td className="text-right whitespace-nowrap tabular-nums">
                          {formatMoney(batch.totalPayMinor, batch.currency)}
                        </td>
                        <td className="tabular-nums">{batch.exportCount}</td>
                        <td>
                          <span className="flex flex-wrap items-center gap-1.5 py-2">
                            <RefChip tone={PAYROLL_TONE[batch.status]} className="font-normal">
                              {PAYROLL_BATCH_STATUS_LABELS[batch.status]}
                            </RefChip>
                            {attention && batch.attention ? (
                              <RefChip
                                tone={attentionTone(batch.attention)}
                                className="font-normal"
                              >
                                {attention}
                              </RefChip>
                            ) : null}
                          </span>
                        </td>
                        <td className="text-right">
                          <DetailDrawerTrigger
                            triggerLabel="⋯"
                            triggerClassName="justify-center px-2 text-lg font-bold text-chelth-navy no-underline sm:min-h-9"
                            triggerAccessibleLabel={`Payroll batch details for ${batch.reference}`}
                            title="Payroll Batch Details"
                            width="profile"
                          >
                            <BatchDetailsPanel
                              batch={batch}
                              details={details.get(batch.id) ?? null}
                              recordHref={recordHref(batch)}
                              nextStep={nextStep(batch)}
                              makerChecker={settings.makerCheckerRequired}
                            />
                          </DetailDrawerTrigger>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DataTableRegion>
          )}
        </RefPanel>

        <RefPanel
          title="Ready to Prepare"
          titleId="payroll-ready-heading"
          className="scroll-mt-24"
          action={
            <span className="text-[13.5px] text-muted-foreground">Priced work not in a batch</span>
          }
        >
          {ready.length === 0 && held.length === 0 ? (
            <LockedEmpty
              icon="pricing"
              title="All priced work is in a batch."
              note="Locked timesheets appear here once they are priced."
            />
          ) : (
            <DataTableRegion
              aria-label="Unprepared payroll work"
              className="mt-[9px] rounded-none border-0 bg-transparent"
            >
              <table className={cn(REF_TABLE, "min-w-[760px]")}>
                <thead className={REF_TEXT.tableHead}>
                  <tr>
                    <th scope="col">Payroll Period</th>
                    <th scope="col">Workers</th>
                    <th scope="col">Lines</th>
                    <th scope="col">Time</th>
                    <th scope="col" className="text-right">
                      Pay Total
                    </th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className={REF_TEXT.tableBody}>
                  {[...held, ...ready].map((row) => {
                    const period = formatPeriod(row.periodStart, row.periodEnd);
                    return (
                      <tr
                        key={`${row.periodStart}-${row.currency}-${row.adjustmentRequired}`}
                        className="h-[42px]"
                      >
                        <td>
                          <span className="font-medium text-chelth-navy">{period}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {row.currency}
                          </span>
                        </td>
                        <td className="tabular-nums">{row.workerCount}</td>
                        <td className="tabular-nums">{row.lineCount}</td>
                        <td className="whitespace-nowrap tabular-nums">
                          {formatWorkedMinutes(row.totalRegularMinutes + row.totalOvertimeMinutes)}
                        </td>
                        <td className="text-right whitespace-nowrap tabular-nums">
                          {formatMoney(row.totalPayMinor, row.currency)}
                        </td>
                        <td>
                          <span className="flex justify-end py-1.5">
                            {row.adjustmentRequired ? (
                              <RefChip tone="warning" className="font-normal">
                                Adjustment required
                              </RefChip>
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
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DataTableRegion>
          )}
        </RefPanel>

        <RefPanel
          title="Needs Attention"
          titleId="payroll-attention-heading"
          className="scroll-mt-24"
        >
          {issues.length === 0 ? (
            <LockedEmpty
              icon="payroll"
              title="Nothing needs attention."
              note="Unpriced work and work revised after preparation appear here."
            />
          ) : (
            <div className="px-[5px] pt-2">
              <IssuesTable
                rows={issues}
                label="Payroll issues"
                documentHref={(id) => `${base}/${id}`}
                pricingHref={`/app/organisations/${organisationId}/pricing?state=ready`}
                showFacility={false}
              />
            </div>
          )}
        </RefPanel>

        <RefPanel
          title="Payroll Adjustments"
          titleId="payroll-adjustments-heading"
          className="scroll-mt-24"
          action={
            <RefChip tone="neutral" className="font-semibold">
              Pay-side delta only
            </RefChip>
          }
        >
          <div className="flex flex-col gap-4 px-[5px] pt-1">
            <RecordNote className="max-w-3xl">
              When locked work is revised, the original batch never changes. The difference between
              the last accounted revision and the new priced revision is prepared as a separate
              adjustment document. An adjustment is not a payment.
            </RecordNote>
            {/* The shared tables keep their own empty states for Invoices; Payroll uses the
                locked quiet tile when nothing needs adjusting and nothing has been adjusted. */}
            {candidates.length === 0 && adjustments.length === 0 ? (
              <LockedEmpty
                icon="payroll"
                title="No payroll adjustments."
                note="Adjustments appear here when locked work is revised after preparation."
              />
            ) : (
              <>
                {candidates.length > 0 ? (
                  <PayrollAdjustmentCandidates
                    rows={candidates}
                    organisationId={organisationId}
                    canPrepare={canPrepare}
                  />
                ) : null}
                {adjustments.length > 0 ? (
                  <PayrollAdjustmentsTable rows={adjustments} organisationId={organisationId} />
                ) : null}
              </>
            )}
          </div>
        </RefPanel>

        <RefPanel title="Reconciliation" titleId="payroll-reconciliation-heading">
          <div className="flex flex-col gap-3 px-[5px] pt-1">
            <RecordNote className="max-w-3xl">
              Where every current priced pay line stands. Lines in a batch keep the revision they
              were prepared with.
            </RecordNote>
            <ReconciliationTable
              rows={reconciliation}
              label="Payroll reconciliation"
              amountLabel="Pay amount"
            />
          </div>
        </RefPanel>

        {settingsEditable ? (
          <RecordNote>
            Payroll period, reference prefixes and the second-approver control are in{" "}
            <Link
              href={`/app/organisations/${organisationId}/settings/payroll` as Route}
              className="text-primary underline underline-offset-4"
            >
              Settings
            </Link>
            .
          </RecordNote>
        ) : null}
      </div>
    </div>
  );
}
