import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Panel } from "@/components/ui/panel";

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
  createInvoiceDraftAction,
  getReconciliation,
  InvoiceStatusBadge,
  InvoiceAdjustmentCandidates,
  InvoiceAdjustmentsTable,
  IssuesTable,
  listBillableWork,
  listInvoiceAdjustmentCandidates,
  listInvoiceAdjustments,
  listInvoiceDrafts,
  listInvoiceIssues,
  ReconciliationTable,
} from "@/features/financial";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";
import { INVOICE_DRAFT_STATUS_LABELS, INVOICE_DRAFT_STATUSES } from "@/lib/domain/financial";
import { formatMoney } from "@/lib/domain/pricing";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";

export const metadata: Metadata = { title: "Invoices" };

/**
 * Invoice DRAFTING from bill-side pricing, grouped by facility relationship
 * and week. Drafts are internal: Chelth does not send invoices, calculate tax
 * or collect payment. No pay value or margin appears here.
 */
export default async function InvoicesPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/invoices">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.INVOICE_VIEW);
  const { organisationId, organisation, can } = context;
  if (organisation.type !== "agency") notFound();

  const [work, issues, drafts, reconciliation, candidates, adjustments] = await Promise.all([
    listBillableWork(organisationId),
    listInvoiceIssues(organisationId),
    listInvoiceDrafts(organisationId),
    getReconciliation(organisationId, "bill"),
    listInvoiceAdjustmentCandidates(organisationId),
    listInvoiceAdjustments(organisationId),
  ]);
  const canPrepare = can(CAPABILITIES.INVOICE_PREPARE) === "granted";
  const approve = can(CAPABILITIES.INVOICE_APPROVE);
  const base = `/app/organisations/${organisationId}/invoices` as const;
  const counts = INVOICE_DRAFT_STATUSES.map((status) => ({
    status,
    count: drafts.filter((draft) => draft.status === status).length,
  })).filter((entry) => entry.count > 0);
  const facilities = [...new Set(work.map((row) => row.facilityName))];
  // Display filter over the drafts already loaded (no new query).
  const rawStatus = (await searchParams).status;
  const statusFilter = INVOICE_DRAFT_STATUSES.find(
    (status) => status === (Array.isArray(rawStatus) ? rawStatus[0] : rawStatus),
  );
  const shownDrafts = statusFilter
    ? drafts.filter((draft) => draft.status === statusFilter)
    : drafts;
  const readyWeeks = work.filter((row) => !row.adjustmentRequired).length;
  const anchor = (id: string) => `${base}#${id}` as Route;

  return (
    <>
      <PageHeader
        title="Invoices"
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
            Draft invoices from billable, priced work for each facility and week. Bill amounts are
            copied exactly from pricing. Drafts are internal documents: Chelth does not send them,
            calculate tax or collect payment.
          </p>
        }
        meta={<Badge tone="neutral">Internal drafts — not sent</Badge>}
        primaryAction={
          canPrepare && readyWeeks > 0 ? (
            <a
              href="#invoice-billable-heading"
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              Create a draft
            </a>
          ) : undefined
        }
      />

      <KpiFilterGroup label="Invoice summary">
        <KpiFilterCard
          label="Blocked"
          value={issues.length}
          supporting="Needs attention before drafting"
          icon={<WorkspaceNavIcon name="compliance" />}
          href={anchor("invoice-attention-heading")}
        />
        <KpiFilterCard
          label="Weeks ready to draft"
          value={readyWeeks}
          supporting="Billable work not yet in a draft"
          icon={<WorkspaceNavIcon name="pricing" />}
          href={anchor("invoice-billable-heading")}
        />
        <KpiFilterCard
          label="Awaiting approval"
          value={drafts.filter((draft) => draft.status === "reviewed").length}
          supporting="Drafts marked reviewed"
          icon={<WorkspaceNavIcon name="invoices" />}
          href={`${base}?status=reviewed` as Route}
          active={statusFilter === "reviewed"}
        />
        <KpiFilterCard
          label="Adjustments required"
          value={candidates.filter((row) => row.state === "required").length}
          supporting="Revised after locking"
          icon={<WorkspaceNavIcon name="timesheets" />}
          href={anchor("invoice-adjustments-heading")}
        />
      </KpiFilterGroup>

      {approve === "step_up_required" ? (
        <StepUpNotice returnTo={base}>
          Approving, locking, voiding and exporting invoice drafts requires verification with your
          authenticator app.
        </StepUpNotice>
      ) : null}

      <Panel titleId="invoice-attention-heading" title={<>Blocked and needs attention</>}>
        {issues.length === 0 ? (
          <EmptyState headingLevel={3} title="Nothing is blocked." />
        ) : (
          <IssuesTable
            rows={issues}
            label="Invoice issues"
            documentHref={(id) => `${base}/${id}`}
            pricingHref={`/app/organisations/${organisationId}/pricing?state=ready`}
            showFacility
          />
        )}
      </Panel>

      <Panel titleId="invoice-adjustments-heading" title={<>Adjustments</>}>
        <p className="max-w-2xl text-sm text-muted-foreground">
          When billed work is revised after a draft is locked, the draft never changes. The
          bill-side difference is prepared as a separate adjustment draft: an additional charge or a
          credit. Adjustment drafts are internal and are not sent.
        </p>
        <InvoiceAdjustmentCandidates
          rows={candidates}
          organisationId={organisationId}
          canPrepare={canPrepare}
        />
        <InvoiceAdjustmentsTable rows={adjustments} organisationId={organisationId} />
      </Panel>

      <Panel titleId="invoice-billable-heading" title={<>Billable work not yet drafted</>}>
        {work.length === 0 ? (
          <EmptyState headingLevel={3} title="All billable work is in a draft." />
        ) : (
          facilities.map((facility) => (
            <div key={facility} className="flex flex-col gap-2">
              <h3 className="text-base font-semibold">{facility}</h3>
              <DataTableRegion aria-label={`Billable work for ${facility}`}>
                <DataTable className="min-w-[680px]">
                  <DataTableHead>
                    <tr>
                      <DataTableHeaderCell>Week</DataTableHeaderCell>
                      <DataTableHeaderCell numeric>Workers</DataTableHeaderCell>
                      <DataTableHeaderCell numeric>Time</DataTableHeaderCell>
                      <DataTableHeaderCell numeric>Bill total</DataTableHeaderCell>
                      <DataTableHeaderCell>
                        <span className="sr-only">Actions</span>
                      </DataTableHeaderCell>
                    </tr>
                  </DataTableHead>
                  <tbody>
                    {work
                      .filter((row) => row.facilityName === facility)
                      .map((row) => {
                        const week = formatPeriod(row.periodStart, row.periodEnd);
                        return (
                          <DataTableRow
                            key={`${row.relationshipId}-${row.periodStart}-${row.currency}-${row.adjustmentRequired}`}
                          >
                            <DataTableCell>
                              <div className="font-medium">{week}</div>
                              <div className="text-xs text-muted-foreground">
                                {row.currency}
                                {row.relationshipStatus !== "active"
                                  ? ` · relationship ${row.relationshipStatus}`
                                  : ""}
                              </div>
                            </DataTableCell>
                            <DataTableCell numeric>{row.workerCount}</DataTableCell>
                            <DataTableCell numeric>
                              {formatWorkedMinutes(row.totalPricedMinutes)}
                            </DataTableCell>
                            <DataTableCell numeric>
                              {formatMoney(row.totalBillMinor, row.currency)}
                            </DataTableCell>
                            <DataTableCell>
                              {row.adjustmentRequired ? (
                                <AttentionBadge code="ADJUSTMENT_REQUIRED" />
                              ) : canPrepare ? (
                                <InlineActionForm
                                  action={createInvoiceDraftAction}
                                  fields={{
                                    organisationId,
                                    relationshipId: row.relationshipId,
                                    periodStart: row.periodStart,
                                    currency: row.currency,
                                  }}
                                  label="Create draft"
                                  accessibleLabel={`Create invoice draft for ${facility}, ${week} (${row.currency})`}
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
            </div>
          ))
        )}
      </Panel>

      <Panel titleId="invoice-drafts-heading" title={<>Invoice drafts</>}>
        {counts.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {counts
              .map(
                (entry) =>
                  `${entry.count} ${INVOICE_DRAFT_STATUS_LABELS[entry.status].toLowerCase()}`,
              )
              .join(" · ")}
          </p>
        ) : null}
        {drafts.length > 0 ? (
          <FilterBar
            key={statusFilter ?? "all"}
            label="Filter invoice drafts"
            resetHref={statusFilter ? (base as Route) : undefined}
          >
            <FilterSelect
              label="Draft status"
              id="draft-status"
              name="status"
              defaultValue={statusFilter ?? ""}
            >
              <option value="">All statuses</option>
              {INVOICE_DRAFT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {INVOICE_DRAFT_STATUS_LABELS[status]}
                </option>
              ))}
            </FilterSelect>
          </FilterBar>
        ) : null}
        {drafts.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No invoice drafts yet."
            description="Create a draft from billable work above."
          />
        ) : (
          <DataTableRegion aria-label="Invoice drafts table">
            <DataTable className="min-w-[820px]">
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Draft</DataTableHeaderCell>
                  <DataTableHeaderCell>Facility</DataTableHeaderCell>
                  <DataTableHeaderCell>Week</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell numeric>Bill total</DataTableHeaderCell>
                  <DataTableHeaderCell numeric>Exports</DataTableHeaderCell>
                  <DataTableHeaderCell>
                    <span className="sr-only">Preview</span>
                  </DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                {shownDrafts.map((draft) => (
                  <DataTableRow key={draft.id}>
                    <DataTableCell>
                      <Link
                        href={`${base}/${draft.id}`}
                        className="font-medium text-primary underline underline-offset-4"
                      >
                        {draft.reference}
                      </Link>
                    </DataTableCell>
                    <DataTableCell>{draft.facilityName}</DataTableCell>
                    <DataTableCell>
                      {formatPeriod(draft.periodStart, draft.periodEnd)}
                    </DataTableCell>
                    <DataTableCell>
                      <div className="flex flex-wrap gap-1">
                        <InvoiceStatusBadge status={draft.status} />
                        <AttentionBadge code={draft.attention} />
                      </div>
                    </DataTableCell>
                    <DataTableCell numeric>
                      {formatMoney(draft.totalBillMinor, draft.currency)}
                    </DataTableCell>
                    <DataTableCell numeric>{draft.exportCount}</DataTableCell>
                    <DataTableCell>
                      <DetailDrawerTrigger
                        triggerLabel="Preview"
                        triggerAccessibleLabel={`Preview ${draft.reference}`}
                        title={draft.reference}
                        description={`${draft.facilityName} · ${formatPeriod(draft.periodStart, draft.periodEnd)}`}
                        footer={
                          <Link
                            href={`${base}/${draft.id}` as Route}
                            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
                          >
                            Open draft
                          </Link>
                        }
                      >
                        <KeyValueList
                          items={[
                            {
                              label: "Status",
                              value: (
                                <span className="flex flex-wrap gap-1">
                                  <InvoiceStatusBadge status={draft.status} />
                                  <AttentionBadge code={draft.attention} />
                                </span>
                              ),
                            },
                            { label: "Facility", value: draft.facilityName },
                            {
                              label: "Week",
                              value: formatPeriod(draft.periodStart, draft.periodEnd),
                            },
                            { label: "Currency", value: draft.currency },
                            {
                              label: "Bill total",
                              value: formatMoney(draft.totalBillMinor, draft.currency),
                            },
                            { label: "Exports", value: draft.exportCount },
                          ]}
                        />
                        <p className="text-sm text-muted-foreground">
                          Draft invoice — internal, not sent. Review, approval, locking and exports
                          happen on the draft page.
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

      <Panel titleId="invoice-reconciliation-heading" title={<>Reconciliation</>}>
        <ReconciliationTable
          rows={reconciliation}
          label="Invoice reconciliation"
          amountLabel="Bill amount"
        />
      </Panel>
    </>
  );
}
