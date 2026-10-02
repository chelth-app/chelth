import type { Metadata, Route } from "next";
import Link from "next/link";

import { Panel } from "@/components/ui/panel";
import { notFound } from "next/navigation";

import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { InlineActionForm } from "@/components/forms/inline-action-form";
import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { Badge } from "@/components/ui/badge";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterSelect } from "@/components/ui/filter-bar";
import { KeyValueList } from "@/components/ui/key-value-list";
import { KpiFilterCard, KpiFilterGroup } from "@/components/ui/kpi-filter-card";
import { PageHeader } from "@/components/ui/page-header";
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

import { FinanceModeTabs } from "../_components/finance-mode-tabs";

export const metadata: Metadata = { title: "Payroll" };

/**
 * Payroll PREPARATION: priced work grouped into payroll periods, batches by
 * state and what needs attention first. Chelth does not run payroll, pay
 * workers or calculate tax or deductions.
 */
export default async function PayrollPage({
  params,
  searchParams,
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
  // Display filter over the batches already loaded (no new query).
  const rawStatus = (await searchParams).status;
  const statusFilter = PAYROLL_BATCH_STATUSES.find(
    (status) => status === (Array.isArray(rawStatus) ? rawStatus[0] : rawStatus),
  );
  const shownBatches = statusFilter
    ? batches.filter((batch) => batch.status === statusFilter)
    : batches;
  const awaitingApproval = batches.filter((batch) => batch.status === "reviewed").length;
  const anchor = (id: string) => `${base}#${id}` as Route;

  return (
    <>
      <PageHeader
        title="Payroll"
        back={
          <Link
            href={`/app/organisations/${organisationId}`}
            className="text-primary underline underline-offset-4"
          >
            {organisation.name}
          </Link>
        }
        description={
          <p>
            Prepare payroll batches from priced, locked timesheets. Amounts are copied exactly from
            pricing and never recalculated. Chelth prepares and exports payroll data; it does not
            run payroll, pay workers or calculate tax or deductions.
          </p>
        }
        meta={
          <>
            <Badge tone="neutral">Preparation and export only</Badge>
            <span className="text-sm text-muted-foreground">
              Payroll periods: {PAYROLL_PERIOD_TYPE_LABELS[settings.payrollPeriodType]}, aligned to{" "}
              {formatCalendarDate(settings.payrollAnchorDate)}.
            </span>
          </>
        }
        primaryAction={
          canPrepare && ready.length > 0 ? (
            <a
              href="#payroll-ready-heading"
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              Prepare a batch
            </a>
          ) : undefined
        }
      />

      <FinanceModeTabs organisationId={organisationId} current="payroll" can={can} />

      <KpiFilterGroup label="Payroll summary">
        <KpiFilterCard
          label="Needs attention"
          value={issues.length}
          supporting="Unpriced or revised work"
          icon={<WorkspaceNavIcon name="compliance" />}
          href={anchor("payroll-attention-heading")}
        />
        <KpiFilterCard
          label="Periods ready to prepare"
          value={ready.length}
          supporting="Priced work not yet in a batch"
          icon={<WorkspaceNavIcon name="pricing" />}
          href={anchor("payroll-ready-heading")}
        />
        <KpiFilterCard
          label="Awaiting approval"
          value={awaitingApproval}
          supporting="Batches marked reviewed"
          icon={<WorkspaceNavIcon name="payroll" />}
          href={`${base}?status=reviewed` as Route}
          active={statusFilter === "reviewed"}
        />
        <KpiFilterCard
          label="Adjustments required"
          value={candidates.filter((row) => row.state === "required").length}
          supporting="Revised after locking"
          icon={<WorkspaceNavIcon name="timesheets" />}
          href={anchor("payroll-adjustments-heading")}
        />
      </KpiFilterGroup>

      {approve === "step_up_required" ? (
        <StepUpNotice returnTo={base}>
          Approving, locking and exporting payroll requires verification with your authenticator
          app.
        </StepUpNotice>
      ) : null}

      <Panel titleId="payroll-attention-heading" title={<>Needs attention</>}>
        {issues.length === 0 ? (
          <EmptyState headingLevel={3} title="Nothing needs attention." />
        ) : (
          <IssuesTable
            rows={issues}
            label="Payroll issues"
            documentHref={(id) => `${base}/${id}`}
            pricingHref={`/app/organisations/${organisationId}/pricing?state=ready`}
            showFacility={false}
          />
        )}
      </Panel>

      <Panel titleId="payroll-adjustments-heading" title={<>Adjustments</>}>
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
      </Panel>

      <Panel titleId="payroll-ready-heading" title={<>Priced work not yet in a batch</>}>
        {ready.length === 0 && held.length === 0 ? (
          <EmptyState headingLevel={3} title="All priced work is in a batch." />
        ) : (
          <DataTableRegion aria-label="Unprepared payroll work">
            <DataTable className="min-w-[760px]">
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Payroll period</DataTableHeaderCell>
                  <DataTableHeaderCell numeric>Workers</DataTableHeaderCell>
                  <DataTableHeaderCell numeric>Lines</DataTableHeaderCell>
                  <DataTableHeaderCell numeric>Time</DataTableHeaderCell>
                  <DataTableHeaderCell numeric>Pay total</DataTableHeaderCell>
                  <DataTableHeaderCell>
                    <span className="sr-only">Actions</span>
                  </DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                {[...held, ...ready].map((row) => {
                  const period = formatPeriod(row.periodStart, row.periodEnd);
                  return (
                    <DataTableRow
                      key={`${row.periodStart}-${row.currency}-${row.adjustmentRequired}`}
                    >
                      <DataTableCell>
                        <div className="font-medium">{period}</div>
                        <div className="text-xs text-muted-foreground">{row.currency}</div>
                      </DataTableCell>
                      <DataTableCell numeric>{row.workerCount}</DataTableCell>
                      <DataTableCell numeric>{row.lineCount}</DataTableCell>
                      <DataTableCell numeric>
                        {formatWorkedMinutes(row.totalRegularMinutes + row.totalOvertimeMinutes)}
                      </DataTableCell>
                      <DataTableCell numeric>
                        {formatMoney(row.totalPayMinor, row.currency)}
                      </DataTableCell>
                      <DataTableCell>
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
                      </DataTableCell>
                    </DataTableRow>
                  );
                })}
              </tbody>
            </DataTable>
          </DataTableRegion>
        )}
      </Panel>

      <Panel titleId="payroll-batches-heading" title={<>Payroll batches</>}>
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
        {batches.length > 0 ? (
          <FilterBar
            key={statusFilter ?? "all"}
            label="Filter payroll batches"
            resetHref={statusFilter ? (base as Route) : undefined}
          >
            <FilterSelect
              label="Batch status"
              id="batch-status"
              name="status"
              defaultValue={statusFilter ?? ""}
            >
              <option value="">All statuses</option>
              {PAYROLL_BATCH_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {PAYROLL_BATCH_STATUS_LABELS[status]}
                </option>
              ))}
            </FilterSelect>
          </FilterBar>
        ) : null}
        {batches.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No payroll batches yet."
            description="Prepare a batch from priced work above."
          />
        ) : (
          <DataTableRegion aria-label="Payroll batches table">
            <DataTable className="min-w-[820px]">
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Batch</DataTableHeaderCell>
                  <DataTableHeaderCell>Period</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell numeric>Workers</DataTableHeaderCell>
                  <DataTableHeaderCell numeric>Pay total</DataTableHeaderCell>
                  <DataTableHeaderCell numeric>Exports</DataTableHeaderCell>
                  <DataTableHeaderCell>
                    <span className="sr-only">Preview</span>
                  </DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                {shownBatches.map((batch) => (
                  <DataTableRow key={batch.id}>
                    <DataTableCell>
                      <Link
                        href={`${base}/${batch.id}`}
                        className="font-medium text-primary underline underline-offset-4"
                      >
                        {batch.reference}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        Prepared by {batch.createdByName ?? "a former member"}
                      </div>
                    </DataTableCell>
                    <DataTableCell>
                      {formatPeriod(batch.periodStart, batch.periodEnd)}
                    </DataTableCell>
                    <DataTableCell>
                      <div className="flex flex-wrap gap-1">
                        <PayrollStatusBadge status={batch.status} />
                        <AttentionBadge code={batch.attention} />
                      </div>
                    </DataTableCell>
                    <DataTableCell numeric>{batch.workerCount}</DataTableCell>
                    <DataTableCell numeric>
                      {formatMoney(batch.totalPayMinor, batch.currency)}
                    </DataTableCell>
                    <DataTableCell numeric>{batch.exportCount}</DataTableCell>
                    <DataTableCell>
                      <DetailDrawerTrigger
                        triggerLabel="Preview"
                        triggerAccessibleLabel={`Preview ${batch.reference}`}
                        title={batch.reference}
                        description={`${formatPeriod(batch.periodStart, batch.periodEnd)} · ${batch.currency}`}
                        footer={
                          <Link
                            href={`${base}/${batch.id}` as Route}
                            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
                          >
                            Open batch
                          </Link>
                        }
                      >
                        <KeyValueList
                          items={[
                            {
                              label: "Status",
                              value: (
                                <span className="flex flex-wrap gap-1">
                                  <PayrollStatusBadge status={batch.status} />
                                  <AttentionBadge code={batch.attention} />
                                </span>
                              ),
                            },
                            {
                              label: "Period",
                              value: formatPeriod(batch.periodStart, batch.periodEnd),
                            },
                            { label: "Currency", value: batch.currency },
                            { label: "Workers", value: batch.workerCount },
                            {
                              label: "Pay total",
                              value: formatMoney(batch.totalPayMinor, batch.currency),
                            },
                            { label: "Exports", value: batch.exportCount },
                            {
                              label: "Prepared by",
                              value: batch.createdByName ?? "a former member",
                            },
                          ]}
                        />
                        <p className="text-sm text-muted-foreground">
                          Review, approval, locking and exports happen on the batch page. Payroll
                          preparation only — no payment.
                        </p>
                      </DetailDrawerTrigger>
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </tbody>
            </DataTable>
          </DataTableRegion>
        )}
      </Panel>

      <Panel titleId="payroll-reconciliation-heading" title={<>Reconciliation</>}>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Where every current priced pay line stands. Lines in a batch keep the revision they were
          prepared with.
        </p>
        <ReconciliationTable
          rows={reconciliation}
          label="Payroll reconciliation"
          amountLabel="Pay amount"
        />
      </Panel>

      {settingsEditable ? (
        <Panel titleId="payroll-settings-heading" title={<>Payroll settings</>}>
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
        </Panel>
      ) : null}
    </>
  );
}
