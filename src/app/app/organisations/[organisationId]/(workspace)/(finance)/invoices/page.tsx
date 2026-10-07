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
import { LocationPin } from "@/components/ui/location-pin";
import { PageHeader } from "@/components/ui/page-header";
import {
  createInvoiceDraftAction,
  getFinancialSettings,
  getReconciliation,
  InvoiceAdjustmentCandidates,
  InvoiceAdjustmentsTable,
  type InvoiceDraftRow,
  IssuesTable,
  listBillableWork,
  listInvoiceAdjustmentCandidates,
  listInvoiceAdjustments,
  listInvoiceDraftHistory,
  listInvoiceDraftLines,
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
import {
  attentionLabel,
  INVOICE_DRAFT_STATUS_LABELS,
  INVOICE_DRAFT_STATUSES,
} from "@/lib/domain/financial";
import { formatMoney } from "@/lib/domain/pricing";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";
import { cn } from "@/lib/utils/cn";

import { HeaderAddAction, LockedEmpty, LockedFilterSelect } from "../_components/finance-locked";
import { type InvoiceDetails, InvoiceDetailsPanel } from "./_components/invoice-details-panel";
import { attentionTone, INVOICE_TONE, NEXT_STEP_LABEL } from "./_components/invoice-tones";

export const metadata: Metadata = { title: "Invoices" };

/**
 * Drawer details (lines and history) are read for at most this many listed
 * drafts per view; further rows open the record for them.
 */
const DETAIL_LIMIT = 15;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

/**
 * Invoice DRAFTING (locked finance system, Payroll sibling): bill-side pricing
 * grouped by facility relationship and week, drafts through Draft → Reviewed
 * → Approved → Locked → Exported (or Voided), adjustments and reconciliation.
 * Drafts are internal: Chelth does not send invoices, calculate tax or collect
 * payment. No pay value or margin appears here. Figures count the loaded
 * records; filters narrow the loaded drafts (no new query).
 */
export default async function InvoicesPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/invoices">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.INVOICE_VIEW);
  const { organisationId, organisation, can } = context;
  if (organisation.type !== "agency") notFound();

  const [settings, work, issues, drafts, reconciliation, candidates, adjustments] =
    await Promise.all([
      getFinancialSettings(organisationId),
      listBillableWork(organisationId),
      listInvoiceIssues(organisationId),
      listInvoiceDrafts(organisationId),
      getReconciliation(organisationId, "bill"),
      listInvoiceAdjustmentCandidates(organisationId),
      listInvoiceAdjustments(organisationId),
    ]);
  const canPrepare = can(CAPABILITIES.INVOICE_PREPARE) === "granted";
  const approve = can(CAPABILITIES.INVOICE_APPROVE);
  const exportCap = can(CAPABILITIES.INVOICE_EXPORT);
  const base = `/app/organisations/${organisationId}/invoices` as const;

  const raw = await searchParams;
  const statusFilter = INVOICE_DRAFT_STATUSES.find((status) => status === first(raw.status));
  const facilities = [...new Set(drafts.map((draft) => draft.facilityName))].sort();
  const facilityFilter = facilities.find((name) => name === first(raw.facility));
  const shownDrafts = drafts.filter(
    (draft) =>
      (!statusFilter || draft.status === statusFilter) &&
      (!facilityFilter || draft.facilityName === facilityFilter),
  );
  const loaded = await Promise.all(
    shownDrafts.slice(0, DETAIL_LIMIT).map(async (draft) => {
      const [lines, history] = await Promise.all([
        listInvoiceDraftLines(draft.id),
        listInvoiceDraftHistory(draft.id),
      ]);
      return [draft.id, { lines, history }] as const;
    }),
  );
  const details = new Map<string, InvoiceDetails>(loaded);

  const ready = work.filter((row) => !row.adjustmentRequired);
  const readyFacilities = new Set(ready.map((row) => row.facilityName)).size;
  const countOf = (status: (typeof INVOICE_DRAFT_STATUSES)[number]) =>
    drafts.filter((draft) => draft.status === status).length;
  const adjustmentsRequired = candidates.filter((row) => row.state === "required").length;
  const hasFilters = Boolean(statusFilter || facilityFilter);
  const quick = (status: (typeof INVOICE_DRAFT_STATUSES)[number]) => ({
    href: `${base}?status=${status}` as Route,
    active: statusFilter === status && !facilityFilter,
  });
  const recordHref = (draft: InvoiceDraftRow) => `${base}/${draft.id}` as Route;
  const nextStep = (draft: InvoiceDraftRow) => {
    const blocked = draft.attention === "SOURCE_SUPERSEDED";
    const allowed =
      (draft.status === "draft" && canPrepare) ||
      (draft.status === "reviewed" && approve === "granted" && !blocked) ||
      (draft.status === "approved" && approve === "granted" && !blocked) ||
      (draft.status === "locked" && exportCap === "granted");
    const label = NEXT_STEP_LABEL[draft.status];
    return allowed && label
      ? { label, href: `${recordHref(draft)}#draft-steps-heading` as Route }
      : null;
  };

  return (
    <div className="chelth-locked flex flex-col gap-[13px]">
      <PageHeader
        variant="reference"
        className="xl:mb-1"
        title="Invoices"
        description={
          <p>
            Prepare, review and export facility invoice drafts from approved, priced work. Chelth
            does not send invoices or collect payment.
          </p>
        }
        meta={
          <>
            <RefChip tone="neutral" className="font-semibold">
              Internal drafts — not sent
            </RefChip>
            <RecordMeta>Bill side only · no tax calculated</RecordMeta>
          </>
        }
        primaryAction={
          canPrepare && ready.length > 0 ? (
            <HeaderAddAction href="#invoice-billable-heading">
              Prepare Invoice Draft
            </HeaderAddAction>
          ) : undefined
        }
      />

      {approve === "step_up_required" ? (
        <StepUpNotice returnTo={base}>
          Approving, locking, voiding and exporting invoice drafts requires verification with your
          authenticator app.
        </StepUpNotice>
      ) : null}

      {/* Locked: with Invoice Details open on wide screens the work area contracts beside it. */}
      <div className="flex flex-col gap-[13px] min-[1536px]:has-[dialog[open]]:pr-[407px]">
        <section
          aria-label="Invoice summary"
          className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-[13px]"
        >
          <RefKpiCard
            label="Needs Attention"
            value={issues.length}
            supporting="Blocked or revised work"
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
            href={`${base}#invoice-attention-heading` as Route}
          />
          <RefKpiCard
            label="Ready to Draft"
            value={ready.length}
            supporting="Billable weeks not in a draft"
            footer={
              <KpiNote tone="info">
                {readyFacilities === 1 ? "1 facility" : `${readyFacilities} facilities`}
              </KpiNote>
            }
            glyph="document"
            icon={<WorkspaceNavIcon name="pricing" strokeWidth={2.25} duotone />}
            tone="warning"
            href={`${base}#invoice-billable-heading` as Route}
          />
          <RefKpiCard
            label="Awaiting Approval"
            value={countOf("reviewed")}
            supporting="Drafts marked reviewed"
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
            icon={<WorkspaceNavIcon name="invoices" strokeWidth={2.25} duotone />}
            tone="teal"
            {...quick("locked")}
          />
        </section>

        {drafts.length > 0 ? (
          // Locked filter row: each control narrows the loaded drafts.
          <form
            key={JSON.stringify([statusFilter, facilityFilter])}
            aria-label="Filter invoice drafts"
            method="get"
            className="flex flex-wrap items-center gap-[9px]"
          >
            <LockedFilterSelect
              id="draft-facility"
              name="facility"
              label="Facility"
              value={facilityFilter ?? ""}
              className="xl:w-[240px]"
              icon={<WorkspaceNavIcon name="facilities" strokeWidth={2.1} />}
            >
              <option value="">All facilities</option>
              {facilities.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </LockedFilterSelect>
            <LockedFilterSelect
              id="draft-status"
              name="status"
              label="Draft status"
              value={statusFilter ?? ""}
              className="xl:w-[200px]"
            >
              <option value="">All statuses</option>
              {INVOICE_DRAFT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {INVOICE_DRAFT_STATUS_LABELS[status]}
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
          title="Invoice Drafts"
          titleId="invoice-drafts-heading"
          className="scroll-mt-24"
          action={
            <span className="text-[13.5px] text-muted-foreground">
              {shownDrafts.length === 1 ? "1 draft" : `${shownDrafts.length} drafts`}
            </span>
          }
        >
          {drafts.length === 0 ? (
            <LockedEmpty
              icon="invoices"
              title="No invoice drafts yet."
              note={
                ready.length > 0
                  ? "Billable work is ready: prepare a draft from it below."
                  : "Approved work appears here when it is ready for invoice preparation."
              }
            />
          ) : shownDrafts.length === 0 ? (
            <LockedEmpty
              icon="invoices"
              title="No invoice drafts match these filters."
              note="Change the facility or status to see others."
            />
          ) : (
            <DataTableRegion
              aria-label="Invoice drafts table"
              className="mt-[9px] rounded-none border-0 bg-transparent"
            >
              <table className={cn(REF_TABLE, "min-w-[960px] table-fixed")}>
                <colgroup>
                  <col className="w-[18%]" />
                  <col className="w-[16%]" />
                  <col className="w-[17%]" />
                  <col className="w-[6%]" />
                  <col className="w-[9%]" />
                  <col className="w-[10%]" />
                  <col className="w-[20%]" />
                  <col className="w-[4%]" />
                </colgroup>
                <thead className={REF_TEXT.tableHead}>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Facility</th>
                    <th scope="col">Week</th>
                    <th scope="col">Lines</th>
                    <th scope="col">Billed Time</th>
                    <th scope="col" className="text-right">
                      Bill Total
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody className={REF_TEXT.tableBody}>
                  {shownDrafts.map((draft) => {
                    const attention = attentionLabel(draft.attention);
                    return (
                      <tr
                        key={draft.id}
                        className="h-[42px] transition-colors hover:bg-surface-muted/50 has-[dialog[open]]:bg-chelth-mint-mist/70 [&:has(dialog[open])>*:first-child]:shadow-[inset_3px_0_0_var(--chelth-teal)]"
                      >
                        <td>
                          <span className="flex flex-col py-1.5">
                            <Link
                              href={recordHref(draft)}
                              className="truncate font-medium text-chelth-navy hover:text-primary hover:underline hover:underline-offset-4"
                            >
                              {draft.reference}
                            </Link>
                            <span className="truncate text-[11px] leading-4 text-muted-foreground">
                              {draft.exportCount === 0
                                ? "Not exported"
                                : draft.exportCount === 1
                                  ? "1 export"
                                  : `${draft.exportCount} exports`}
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className="flex min-w-0 items-center gap-2">
                            <LocationPin className="size-4 shrink-0 text-chelth-teal-dark" />
                            <span className="truncate">{draft.facilityName}</span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap">
                          {formatPeriod(draft.periodStart, draft.periodEnd)}
                        </td>
                        <td className="tabular-nums">{draft.lineCount}</td>
                        <td className="whitespace-nowrap tabular-nums">
                          {formatWorkedMinutes(draft.totalPricedMinutes)}
                        </td>
                        <td className="text-right whitespace-nowrap tabular-nums">
                          {formatMoney(draft.totalBillMinor, draft.currency)}
                        </td>
                        <td>
                          <span className="flex flex-wrap items-center gap-1.5 py-2">
                            <RefChip tone={INVOICE_TONE[draft.status]} className="font-normal">
                              {INVOICE_DRAFT_STATUS_LABELS[draft.status]}
                            </RefChip>
                            {attention && draft.attention ? (
                              <RefChip
                                tone={attentionTone(draft.attention)}
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
                            triggerAccessibleLabel={`Invoice details for ${draft.reference}`}
                            title="Invoice Details"
                            width="profile"
                          >
                            <InvoiceDetailsPanel
                              draft={draft}
                              details={details.get(draft.id) ?? null}
                              recordHref={recordHref(draft)}
                              nextStep={nextStep(draft)}
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
          title="Ready to Draft"
          titleId="invoice-billable-heading"
          className="scroll-mt-24"
          action={
            <span className="text-[13.5px] text-muted-foreground">
              Billable work not in a draft
            </span>
          }
        >
          {work.length === 0 ? (
            <LockedEmpty
              icon="pricing"
              title="All billable work is in a draft."
              note="Locked timesheets appear here once they are priced."
            />
          ) : (
            <DataTableRegion
              aria-label="Billable invoice work"
              className="mt-[9px] rounded-none border-0 bg-transparent"
            >
              <table className={cn(REF_TABLE, "min-w-[820px]")}>
                <thead className={REF_TEXT.tableHead}>
                  <tr>
                    <th scope="col">Facility</th>
                    <th scope="col">Week</th>
                    <th scope="col">Workers</th>
                    <th scope="col">Time</th>
                    <th scope="col" className="text-right">
                      Bill Total
                    </th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className={REF_TEXT.tableBody}>
                  {work.map((row) => {
                    const week = formatPeriod(row.periodStart, row.periodEnd);
                    return (
                      <tr
                        key={`${row.relationshipId}-${row.periodStart}-${row.currency}-${row.adjustmentRequired}`}
                        className="h-[42px]"
                      >
                        <td>
                          <span className="flex min-w-0 items-center gap-2">
                            <LocationPin className="size-4 shrink-0 text-chelth-teal-dark" />
                            <span className="truncate font-medium text-chelth-navy">
                              {row.facilityName}
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className="whitespace-nowrap">{week}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {row.currency}
                            {row.relationshipStatus !== "active"
                              ? ` · relationship ${row.relationshipStatus}`
                              : ""}
                          </span>
                        </td>
                        <td className="tabular-nums">{row.workerCount}</td>
                        <td className="whitespace-nowrap tabular-nums">
                          {formatWorkedMinutes(row.totalPricedMinutes)}
                        </td>
                        <td className="text-right whitespace-nowrap tabular-nums">
                          {formatMoney(row.totalBillMinor, row.currency)}
                        </td>
                        <td>
                          <span className="flex justify-end py-1.5">
                            {row.adjustmentRequired ? (
                              <RefChip tone="warning" className="font-normal">
                                Adjustment required
                              </RefChip>
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
                                accessibleLabel={`Create invoice draft for ${row.facilityName}, ${week} (${row.currency})`}
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
          titleId="invoice-attention-heading"
          className="scroll-mt-24"
        >
          {issues.length === 0 ? (
            <LockedEmpty
              icon="invoices"
              title="Nothing needs attention."
              note="Unpriced billable work and work revised after drafting appear here."
            />
          ) : (
            <div className="px-[5px] pt-2">
              <IssuesTable
                rows={issues}
                label="Invoice issues"
                documentHref={(id) => `${base}/${id}`}
                pricingHref={`/app/organisations/${organisationId}/pricing?state=ready`}
                showFacility
              />
            </div>
          )}
        </RefPanel>

        <RefPanel
          title="Invoice Adjustments"
          titleId="invoice-adjustments-heading"
          className="scroll-mt-24"
          action={
            <RefChip tone="neutral" className="font-semibold">
              Bill-side delta only
            </RefChip>
          }
        >
          <div className="flex flex-col gap-4 px-[5px] pt-1">
            <RecordNote className="max-w-3xl">
              When billed work is revised after a draft is locked, the draft never changes. The
              bill-side difference is prepared as a separate adjustment draft: an additional charge
              or a credit. Adjustment drafts are internal and are not sent.
            </RecordNote>
            {candidates.length === 0 && adjustments.length === 0 ? (
              <LockedEmpty
                icon="invoices"
                title="No adjustments required."
                note="Invoice corrections appear here when locked drafts need a delta adjustment."
              />
            ) : (
              <>
                {candidates.length > 0 ? (
                  <InvoiceAdjustmentCandidates
                    rows={candidates}
                    organisationId={organisationId}
                    canPrepare={canPrepare}
                  />
                ) : null}
                {adjustments.length > 0 ? (
                  <InvoiceAdjustmentsTable rows={adjustments} organisationId={organisationId} />
                ) : null}
              </>
            )}
          </div>
        </RefPanel>

        <RefPanel title="Reconciliation" titleId="invoice-reconciliation-heading">
          <div className="flex flex-col gap-3 px-[5px] pt-1">
            <RecordNote className="max-w-3xl">
              Where every current priced bill line stands. Lines in a draft keep the revision they
              were drafted with. This is revision reconciliation, not payment tracking.
            </RecordNote>
            <ReconciliationTable
              rows={reconciliation}
              label="Invoice reconciliation"
              amountLabel="Bill amount"
            />
          </div>
        </RefPanel>
      </div>
    </div>
  );
}
