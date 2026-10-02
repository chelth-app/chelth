import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import {
  AttentionBadge,
  ExportsTable,
  getInvoiceDraft,
  HistoryList,
  invoiceDraftStepAction,
  InvoiceStatusBadge,
  listFinancialExports,
  listInvoiceDraftHistory,
  listInvoiceDraftLines,
  VoidInvoiceDraftForm,
} from "@/features/financial";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";
import { formatHourlyRate, formatMoney } from "@/lib/domain/pricing";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";

export const metadata: Metadata = { title: "Invoice draft" };

const idSchema = z.uuid();
const TABLE_REGION = "relative overflow-x-auto rounded-lg border border-border bg-surface";
const TH = "px-3 py-2 font-medium";
const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});

/**
 * One internal invoice draft: bill side only. No pay rate, pay amount or
 * margin is read, stored or shown for a draft.
 */
export default async function InvoiceDraftPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/invoices/[draftId]">) {
  const { organisationId: rawOrganisationId, draftId } = await params;
  const context = await loadOrganisationPage(rawOrganisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.INVOICE_VIEW);
  const { organisationId, can } = context;
  const parsed = idSchema.safeParse(draftId);
  if (!parsed.success) notFound();
  const draft = await getInvoiceDraft(parsed.data);
  if (!draft || draft.organisationId !== organisationId) notFound();
  const [lines, exports, history] = await Promise.all([
    listInvoiceDraftLines(draft.id),
    listFinancialExports("invoice_draft", draft.id),
    listInvoiceDraftHistory(draft.id),
  ]);

  const prepare = can(CAPABILITIES.INVOICE_PREPARE);
  const approve = can(CAPABILITIES.INVOICE_APPROVE);
  const exportCap = can(CAPABILITIES.INVOICE_EXPORT);
  const base = `/app/organisations/${organisationId}/invoices` as const;
  const fields = { organisationId, draftId: draft.id };
  const blocked = draft.attention === "SOURCE_SUPERSEDED";
  const exportable = draft.status === "locked" || draft.status === "exported";
  const needsStepUp =
    (["reviewed", "approved", "locked", "exported"].includes(draft.status) &&
      approve === "step_up_required") ||
    (exportable && exportCap === "step_up_required");
  const canVoid =
    draft.status !== "voided" &&
    (["draft", "reviewed"].includes(draft.status) ? prepare === "granted" : approve === "granted");

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href={base} className="w-fit text-sm text-primary underline underline-offset-4">
          Invoices
        </Link>
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Draft invoice — internal, not sent
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{draft.reference}</h1>
          <InvoiceStatusBadge status={draft.status} />
          <AttentionBadge code={draft.attention} />
        </div>
        <p className="text-sm text-muted-foreground">
          {draft.facilityName} · week {formatPeriod(draft.periodStart, draft.periodEnd)} ·{" "}
          {draft.currency} · No tax calculated. Not a request for payment.
        </p>
      </header>

      {needsStepUp ? (
        <StepUpNotice returnTo={`${base}/${draft.id}`}>
          Approving, locking, voiding and exporting invoice drafts requires verification with your
          authenticator app.
        </StepUpNotice>
      ) : null}

      {draft.attention === "ADJUSTMENT_REQUIRED" ? (
        <p role="status" className="rounded-md border border-border bg-warning-soft p-3 text-sm">
          Adjustment required: some billed work was revised after this draft was locked. The draft
          stays exactly as approved; record the difference as an adjustment.
        </p>
      ) : null}
      {blocked ? (
        <p role="alert" className="rounded-md border border-border bg-danger-soft p-3 text-sm">
          Some work in this draft was revised after it was prepared, so it cannot be approved or
          locked. Void the draft and create it again.
        </p>
      ) : null}

      <section aria-labelledby="draft-totals-heading" className="flex flex-col gap-3">
        <h2 id="draft-totals-heading" className="text-lg font-semibold">
          Totals
        </h2>
        <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
          <dt className="text-muted-foreground">Bill total (before any tax)</dt>
          <dd className="font-semibold tabular-nums">
            {formatMoney(draft.totalBillMinor, draft.currency)}
          </dd>
          <dt className="text-muted-foreground">Lines</dt>
          <dd className="tabular-nums">{draft.lineCount}</dd>
          <dt className="text-muted-foreground">Billed time</dt>
          <dd className="tabular-nums">{formatWorkedMinutes(draft.totalPricedMinutes)}</dd>
        </dl>
      </section>

      {draft.status !== "voided" ? (
        <section aria-labelledby="draft-steps-heading" className="flex flex-col gap-3">
          <h2 id="draft-steps-heading" className="text-lg font-semibold">
            Next step
          </h2>
          <div className="flex flex-wrap items-start gap-3">
            {draft.status === "draft" && prepare === "granted" ? (
              <InlineActionForm
                action={invoiceDraftStepAction}
                fields={{ ...fields, step: "review" }}
                label="Mark reviewed"
                variant="primary"
              />
            ) : null}
            {draft.status === "reviewed" && approve === "granted" && !blocked ? (
              <InlineActionForm
                action={invoiceDraftStepAction}
                fields={{ ...fields, step: "approve" }}
                label="Approve draft"
                variant="primary"
              />
            ) : null}
            {draft.status === "approved" && approve === "granted" && !blocked ? (
              <InlineActionForm
                action={invoiceDraftStepAction}
                fields={{ ...fields, step: "lock" }}
                label="Lock draft"
                variant="primary"
              />
            ) : null}
            {exportable && exportCap === "granted" ? (
              <>
                <InlineActionForm
                  action={invoiceDraftStepAction}
                  fields={{ ...fields, step: "export_pdf" }}
                  label="Export draft PDF"
                  variant={draft.status === "locked" ? "primary" : "outline"}
                />
                <InlineActionForm
                  action={invoiceDraftStepAction}
                  fields={{ ...fields, step: "export_csv" }}
                  label="Export draft CSV"
                />
              </>
            ) : null}
            {canVoid ? (
              <VoidInvoiceDraftForm organisationId={organisationId} draftId={draft.id} />
            ) : null}
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          Voided by {draft.voidedByName ?? "a former member"}: “{draft.voidReason}”. The draft is
          unchanged; its work was released for a new draft.
        </p>
      )}

      <section aria-labelledby="draft-exports-heading" className="flex flex-col gap-3">
        <h2 id="draft-exports-heading" className="text-lg font-semibold">
          Draft documents
        </h2>
        <ExportsTable
          rows={exports}
          canDownload={exportCap === "granted"}
          label="Invoice draft exports"
        />
      </section>

      <section aria-labelledby="draft-lines-heading" className="flex flex-col gap-3">
        <h2 id="draft-lines-heading" className="text-lg font-semibold">
          Lines
        </h2>
        <div role="region" aria-label="Invoice draft lines" tabIndex={0} className={TABLE_REGION}>
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
              <tr>
                <th scope="col" className={TH}>
                  Date
                </th>
                <th scope="col" className={TH}>
                  Worker
                </th>
                <th scope="col" className={TH}>
                  Discipline
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Time
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Bill rate
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Amount
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
                  <td className="px-3 py-2">
                    {line.workerName}
                    {line.workerReference ? (
                      <div className="text-xs text-muted-foreground">{line.workerReference}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{line.disciplineName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatWorkedMinutes(line.pricedMinutes)}
                    {line.billOvertimeMinutes > 0 ? (
                      <div className="text-xs text-muted-foreground">
                        incl. {formatWorkedMinutes(line.billOvertimeMinutes)} overtime
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatHourlyRate(line.billRateMinor, draft.currency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(line.billAmountMinor, draft.currency)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    Revision {line.timesheetRevision}
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
        </div>
      </section>

      <section aria-labelledby="draft-history-heading" className="flex flex-col gap-3">
        <h2 id="draft-history-heading" className="text-lg font-semibold">
          History
        </h2>
        <HistoryList rows={history} label="Invoice draft history" />
      </section>
    </>
  );
}
