import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Panel } from "@/components/ui/panel";
import { z } from "zod";

import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { InlineActionForm } from "@/components/forms/inline-action-form";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        title={adjustment.reference}
        back={
          <Link href={base} className="text-primary underline underline-offset-4">
            Invoices
          </Link>
        }
        description={
          <p className="text-sm">
            {direction} · {adjustment.facilityName} · week{" "}
            {formatPeriod(adjustment.periodStart, adjustment.periodEnd)} · {currency} · No tax
            calculated.
          </p>
        }
        meta={
          <>
            <Badge tone="neutral">Draft invoice adjustment — internal, not sent</Badge>
            <InvoiceStatusBadge status={adjustment.status} />
            <AttentionBadge code={adjustment.attention} />
            <Badge tone="neutral">{currency}</Badge>
          </>
        }
      />

      {needsStepUp ? (
        <StepUpNotice returnTo={`${base}/adjustments/${adjustment.id}`}>
          Approving, locking and exporting invoice adjustments requires verification with your
          authenticator app.
        </StepUpNotice>
      ) : null}
      {blocked ? (
        <p
          role="alert"
          className="rounded-md border border-border bg-danger-soft p-3 text-sm text-danger-soft-foreground"
        >
          The timesheet was revised again after this adjustment was prepared, so it cannot be
          approved or locked. Void it and prepare a new adjustment.
        </p>
      ) : null}

      <Panel titleId="inv-adjustment-lineage-heading" title={<>What it adjusts</>}>
        <dl className="grid max-w-2xl grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr] sm:gap-y-2.5">
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
      </Panel>

      <Panel titleId="inv-adjustment-totals-heading" title={<>Net bill adjustment</>}>
        <dl className="grid max-w-xl grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr] sm:gap-y-2.5">
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
      </Panel>

      {adjustment.status !== "voided" ? (
        <Panel titleId="inv-adjustment-steps-heading" title={<>Next step</>}>
          {adjustment.status === "reviewed" && checkerNeeded ? (
            <p
              role="status"
              className="rounded-md border border-border bg-info-soft p-3 text-sm text-info-soft-foreground"
            >
              You prepared this adjustment. A different finance member must approve it.
            </p>
          ) : null}
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
        </Panel>
      ) : (
        <p className="text-sm text-muted-foreground">
          Voided by {adjustment.voidedByName ?? "a former member"}: “{adjustment.voidReason}”.
        </p>
      )}

      <Panel titleId="inv-adjustment-exports-heading" title={<>Draft documents</>}>
        <ExportsTable
          rows={exports}
          canDownload={exportCap === "granted"}
          label="Invoice adjustment exports"
          signedTotals
        />
      </Panel>

      <Panel titleId="inv-adjustment-lines-heading" title={<>Changed lines</>}>
        <DataTableRegion aria-label="Invoice adjustment lines">
          <DataTable className="min-w-[880px]">
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>Date</DataTableHeaderCell>
                <DataTableHeaderCell>Worker · discipline</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Time (original → revised)</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Bill rate</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Bill (original → revised)</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Change</DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {lines.map((line) => (
                <DataTableRow key={line.lineNumber}>
                  <DataTableCell>
                    {dateFormat.format(new Date(`${line.workDate}T00:00:00Z`))}
                  </DataTableCell>
                  <DataTableCell>
                    {line.workerName} · {line.disciplineName}
                  </DataTableCell>
                  <DataTableCell numeric>
                    {formatWorkedMinutes(line.oldPricedMinutes)} →{" "}
                    {formatWorkedMinutes(line.newPricedMinutes)}
                  </DataTableCell>
                  <DataTableCell numeric>
                    {line.oldBillRateMinor === null
                      ? "—"
                      : formatHourlyRate(line.oldBillRateMinor, currency)}{" "}
                    →{" "}
                    {line.newBillRateMinor === null
                      ? "—"
                      : formatHourlyRate(line.newBillRateMinor, currency)}
                  </DataTableCell>
                  <DataTableCell numeric>
                    {line.oldBillAmountMinor === null
                      ? "—"
                      : formatMoney(line.oldBillAmountMinor, currency)}{" "}
                    →{" "}
                    {line.newBillAmountMinor === null
                      ? "—"
                      : formatMoney(line.newBillAmountMinor, currency)}
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    <SignedAmount
                      minor={line.deltaBillAmountMinor}
                      currency={currency}
                      side="bill"
                    />
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
        </DataTableRegion>
      </Panel>

      <Panel titleId="inv-adjustment-history-heading" title={<>History</>}>
        <HistoryList rows={history} label="Invoice adjustment history" />
      </Panel>
    </>
  );
}
