import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DataTableRegion } from "@/components/ui/data-table";
import { InlineActionForm } from "@/components/forms/inline-action-form";
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

const TH = "px-3 py-2 font-medium";

/**
 * Invoice DRAFTING from bill-side pricing, grouped by facility relationship
 * and week. Drafts are internal: Chelth does not send invoices, calculate tax
 * or collect payment. No pay value or margin appears here.
 */
export default async function InvoicesPage({
  params,
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

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          {organisation.name}
        </Link>
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Draft invoices from billable, priced work for each facility and week. Bill amounts are
          copied exactly from pricing. Drafts are internal documents: Chelth does not send them,
          calculate tax or collect payment.
        </p>
      </header>

      {approve === "step_up_required" ? (
        <StepUpNotice returnTo={base}>
          Approving, locking, voiding and exporting invoice drafts requires verification with your
          authenticator app.
        </StepUpNotice>
      ) : null}

      <section aria-labelledby="invoice-attention-heading" className="flex flex-col gap-3">
        <h2 id="invoice-attention-heading" className="text-lg font-semibold">
          Blocked and needs attention
        </h2>
        {issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is blocked.</p>
        ) : (
          <IssuesTable
            rows={issues}
            label="Invoice issues"
            documentHref={(id) => `${base}/${id}`}
            pricingHref={`/app/organisations/${organisationId}/pricing?state=ready`}
            showFacility
          />
        )}
      </section>

      <section aria-labelledby="invoice-adjustments-heading" className="flex flex-col gap-3">
        <h2 id="invoice-adjustments-heading" className="text-lg font-semibold">
          Adjustments
        </h2>
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
      </section>

      <section aria-labelledby="invoice-billable-heading" className="flex flex-col gap-3">
        <h2 id="invoice-billable-heading" className="text-lg font-semibold">
          Billable work not yet drafted
        </h2>
        {work.length === 0 ? (
          <p className="text-sm text-muted-foreground">All billable work is in a draft.</p>
        ) : (
          facilities.map((facility) => (
            <div key={facility} className="flex flex-col gap-2">
              <h3 className="text-base font-semibold">{facility}</h3>
              <DataTableRegion aria-label={`Billable work for ${facility}`}>
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className={TH}>
                        Week
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Workers
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Time
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Bill total
                      </th>
                      <th scope="col" className={TH}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {work
                      .filter((row) => row.facilityName === facility)
                      .map((row) => {
                        const week = formatPeriod(row.periodStart, row.periodEnd);
                        return (
                          <tr
                            key={`${row.relationshipId}-${row.periodStart}-${row.currency}-${row.adjustmentRequired}`}
                            className="border-b border-border align-top last:border-0"
                          >
                            <td className="px-3 py-2">
                              <div className="font-medium">{week}</div>
                              <div className="text-xs text-muted-foreground">
                                {row.currency}
                                {row.relationshipStatus !== "active"
                                  ? ` · relationship ${row.relationshipStatus}`
                                  : ""}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{row.workerCount}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatWorkedMinutes(row.totalPricedMinutes)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatMoney(row.totalBillMinor, row.currency)}
                            </td>
                            <td className="px-3 py-2">
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
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </DataTableRegion>
            </div>
          ))
        )}
      </section>

      <section aria-labelledby="invoice-drafts-heading" className="flex flex-col gap-3">
        <h2 id="invoice-drafts-heading" className="text-lg font-semibold">
          Invoice drafts
        </h2>
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
        {drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoice drafts yet.</p>
        ) : (
          <DataTableRegion aria-label="Invoice drafts table">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className={TH}>
                    Draft
                  </th>
                  <th scope="col" className={TH}>
                    Facility
                  </th>
                  <th scope="col" className={TH}>
                    Week
                  </th>
                  <th scope="col" className={TH}>
                    Status
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Bill total
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Exports
                  </th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft) => (
                  <tr key={draft.id} className="border-b border-border align-top last:border-0">
                    <td className="px-3 py-2">
                      <Link
                        href={`${base}/${draft.id}`}
                        className="font-medium text-primary underline underline-offset-4"
                      >
                        {draft.reference}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{draft.facilityName}</td>
                    <td className="px-3 py-2">
                      {formatPeriod(draft.periodStart, draft.periodEnd)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <InvoiceStatusBadge status={draft.status} />
                        <AttentionBadge code={draft.attention} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(draft.totalBillMinor, draft.currency)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{draft.exportCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTableRegion>
        )}
      </section>

      <section aria-labelledby="invoice-reconciliation-heading" className="flex flex-col gap-3">
        <h2 id="invoice-reconciliation-heading" className="text-lg font-semibold">
          Reconciliation
        </h2>
        <ReconciliationTable
          rows={reconciliation}
          label="Invoice reconciliation"
          amountLabel="Bill amount"
        />
      </section>
    </>
  );
}
