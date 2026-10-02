import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DataTableRegion } from "@/components/ui/data-table";
import { InlineActionForm } from "@/components/forms/inline-action-form";
import {
  AttentionBadge,
  ExportsTable,
  getFinancialSettings,
  getInvoiceAdjustment,
  HistoryList,
  invoiceAdjustmentStepAction,
  InvoiceStatusBadge,
  listFinancialExports,
  listInvoiceAdjustmentHistory,
  listInvoiceAdjustmentLines,
  SignedAmount,
  VoidInvoiceAdjustmentForm,
} from "@/features/financial";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";
import {
  formatSignedMinutes,
  formatSignedMoney,
  invoiceDirectionLabel,
} from "@/lib/domain/financial";
import { formatHourlyRate, formatMoney } from "@/lib/domain/pricing";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";

export const metadata: Metadata = { title: "Invoice adjustment draft" };

const idSchema = z.uuid();
const TH = "px-3 py-2 font-medium";
const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});

/**
 * One invoice adjustment draft: the bill-side difference between the last
 * accounted revision and the new priced revision. No pay value or margin.
 */
export default async function InvoiceAdjustmentPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/invoices/adjustments/[adjustmentId]">) {
  const { organisationId: rawOrganisationId, adjustmentId } = await params;
  const context = await loadOrganisationPage(rawOrganisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.INVOICE_VIEW);
  const { organisationId, can } = context;
  const parsed = idSchema.safeParse(adjustmentId);
  if (!parsed.success) notFound();
  const adjustment = await getInvoiceAdjustment(parsed.data);
  if (!adjustment || adjustment.organisationId !== organisationId) notFound();
  const [lines, exports, history, settings] = await Promise.all([
    listInvoiceAdjustmentLines(adjustment.id),
    listFinancialExports("invoice_adjustment", adjustment.id),
    listInvoiceAdjustmentHistory(adjustment.id),
    getFinancialSettings(organisationId),
  ]);

  const prepare = can(CAPABILITIES.INVOICE_PREPARE);
  const approve = can(CAPABILITIES.INVOICE_APPROVE);
  const exportCap = can(CAPABILITIES.INVOICE_EXPORT);
  const base = `/app/organisations/${organisationId}/invoices` as const;
  const fields = { organisationId, adjustmentId: adjustment.id };
  const blocked = adjustment.attention === "SOURCE_SUPERSEDED";
  const checkerNeeded = settings.makerCheckerRequired && adjustment.preparedByMe;
  const exportable = adjustment.status === "locked" || adjustment.status === "exported";
  const { currency } = adjustment;
  const needsStepUp =
    (["reviewed", "approved"].includes(adjustment.status) && approve === "step_up_required") ||
    (exportable && exportCap === "step_up_required");
  const direction = invoiceDirectionLabel(adjustment.direction);

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href={base} className="w-fit text-sm text-primary underline underline-offset-4">
          Invoices
        </Link>
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Draft invoice adjustment — internal, not sent
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{adjustment.reference}</h1>
          <InvoiceStatusBadge status={adjustment.status} />
          <AttentionBadge code={adjustment.attention} />
        </div>
        <p className="text-sm text-muted-foreground">
          {direction} · {adjustment.facilityName} · week{" "}
          {formatPeriod(adjustment.periodStart, adjustment.periodEnd)} · {currency} · No tax
          calculated.
        </p>
      </header>

      {needsStepUp ? (
        <StepUpNotice returnTo={`${base}/adjustments/${adjustment.id}`}>
          Approving, locking and exporting invoice adjustments requires verification with your
          authenticator app.
        </StepUpNotice>
      ) : null}
      {blocked ? (
        <p role="alert" className="rounded-md border border-border bg-danger-soft p-3 text-sm">
          The timesheet was revised again after this adjustment was prepared, so it cannot be
          approved or locked. Void it and prepare a new adjustment.
        </p>
      ) : null}
      {adjustment.status === "reviewed" && checkerNeeded ? (
        <p role="status" className="rounded-md border border-border bg-info-soft p-3 text-sm">
          You prepared this adjustment. A different finance member must approve it.
        </p>
      ) : null}

      <section aria-labelledby="inv-adjustment-lineage-heading" className="flex flex-col gap-3">
        <h2 id="inv-adjustment-lineage-heading" className="text-lg font-semibold">
          What it adjusts
        </h2>
        <dl className="grid max-w-2xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
          <dt className="text-muted-foreground">Original draft</dt>
          <dd>
            <Link
              href={`${base}/${adjustment.originalDraftId}`}
              className="text-primary underline underline-offset-4"
            >
              {adjustment.originalDraftReference}
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
          </dd>
        </dl>
      </section>

      <section aria-labelledby="inv-adjustment-totals-heading" className="flex flex-col gap-3">
        <h2 id="inv-adjustment-totals-heading" className="text-lg font-semibold">
          Net bill adjustment
        </h2>
        <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
          <dt className="text-muted-foreground">Net (before any tax)</dt>
          <dd>
            <SignedAmount
              minor={adjustment.netDeltaMinor}
              currency={currency}
              side="bill"
              direction={adjustment.direction}
            />
          </dd>
          <dt className="text-muted-foreground">Additional charges</dt>
          <dd className="tabular-nums">
            {formatSignedMoney(adjustment.totalIncreaseMinor, currency)}
          </dd>
          <dt className="text-muted-foreground">Credits</dt>
          <dd className="tabular-nums">
            {formatSignedMoney(-adjustment.totalDecreaseMinor, currency)}
          </dd>
          <dt className="text-muted-foreground">Billed time</dt>
          <dd className="tabular-nums">{formatSignedMinutes(adjustment.deltaPricedMinutes)}</dd>
        </dl>
      </section>

      {adjustment.status !== "voided" ? (
        <section aria-labelledby="inv-adjustment-steps-heading" className="flex flex-col gap-3">
          <h2 id="inv-adjustment-steps-heading" className="text-lg font-semibold">
            Next step
          </h2>
          <div className="flex flex-wrap items-start gap-3">
            {adjustment.status === "draft" && prepare === "granted" ? (
              <InlineActionForm
                action={invoiceAdjustmentStepAction}
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
                action={invoiceAdjustmentStepAction}
                fields={{ ...fields, step: "approve" }}
                label="Approve adjustment"
                variant="primary"
              />
            ) : null}
            {adjustment.status === "approved" && approve === "granted" && !blocked ? (
              <InlineActionForm
                action={invoiceAdjustmentStepAction}
                fields={{ ...fields, step: "lock" }}
                label="Lock adjustment"
                variant="primary"
              />
            ) : null}
            {exportable && exportCap === "granted" ? (
              <>
                <InlineActionForm
                  action={invoiceAdjustmentStepAction}
                  fields={{ ...fields, step: "export_pdf" }}
                  label="Export adjustment PDF"
                  variant={adjustment.status === "locked" ? "primary" : "outline"}
                />
                <InlineActionForm
                  action={invoiceAdjustmentStepAction}
                  fields={{ ...fields, step: "export_csv" }}
                  label="Export adjustment CSV"
                />
              </>
            ) : null}
            {(["draft", "reviewed"].includes(adjustment.status) && prepare === "granted") ||
            (adjustment.status === "approved" && approve === "granted") ? (
              <VoidInvoiceAdjustmentForm
                organisationId={organisationId}
                adjustmentId={adjustment.id}
              />
            ) : null}
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          Voided by {adjustment.voidedByName ?? "a former member"}: “{adjustment.voidReason}”.
        </p>
      )}

      <section aria-labelledby="inv-adjustment-exports-heading" className="flex flex-col gap-3">
        <h2 id="inv-adjustment-exports-heading" className="text-lg font-semibold">
          Draft documents
        </h2>
        <ExportsTable
          rows={exports}
          canDownload={exportCap === "granted"}
          label="Invoice adjustment exports"
          signedTotals
        />
      </section>

      <section aria-labelledby="inv-adjustment-lines-heading" className="flex flex-col gap-3">
        <h2 id="inv-adjustment-lines-heading" className="text-lg font-semibold">
          Changed lines
        </h2>
        <DataTableRegion aria-label="Invoice adjustment lines">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
              <tr>
                <th scope="col" className={TH}>
                  Date
                </th>
                <th scope="col" className={TH}>
                  Worker · discipline
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Time (original → revised)
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Bill rate
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Bill (original → revised)
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
                    {line.workerName} · {line.disciplineName}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatWorkedMinutes(line.oldPricedMinutes)} →{" "}
                    {formatWorkedMinutes(line.newPricedMinutes)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {line.oldBillRateMinor === null
                      ? "—"
                      : formatHourlyRate(line.oldBillRateMinor, currency)}{" "}
                    →{" "}
                    {line.newBillRateMinor === null
                      ? "—"
                      : formatHourlyRate(line.newBillRateMinor, currency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {line.oldBillAmountMinor === null
                      ? "—"
                      : formatMoney(line.oldBillAmountMinor, currency)}{" "}
                    →{" "}
                    {line.newBillAmountMinor === null
                      ? "—"
                      : formatMoney(line.newBillAmountMinor, currency)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <SignedAmount
                      minor={line.deltaBillAmountMinor}
                      currency={currency}
                      side="bill"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableRegion>
      </section>

      <section aria-labelledby="inv-adjustment-history-heading" className="flex flex-col gap-3">
        <h2 id="inv-adjustment-history-heading" className="text-lg font-semibold">
          History
        </h2>
        <HistoryList rows={history} label="Invoice adjustment history" />
      </section>
    </>
  );
}
