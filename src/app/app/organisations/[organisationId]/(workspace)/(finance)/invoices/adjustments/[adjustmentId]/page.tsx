import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

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
import { RefChip } from "@/components/reference/locked-reference";
import { RecordMeta, RecordNote, RecordPage } from "@/components/reference/record-page";
import { KeyValueList } from "@/components/ui/key-value-list";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SectionTabs } from "@/components/ui/section-tabs";
import {
  ExportsTable,
  getFinancialSettings,
  getInvoiceAdjustment,
  HistoryList,
  invoiceAdjustmentStepAction,
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
  attentionLabel,
  formatSignedMinutes,
  formatSignedMoney,
  INVOICE_DRAFT_STATUS_LABELS,
  invoiceDirectionLabel,
} from "@/lib/domain/financial";
import { formatHourlyRate, formatMoney } from "@/lib/domain/pricing";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";

import { LockedNotice } from "../../../_components/finance-locked";
import { attentionTone, INVOICE_TONE } from "../../_components/invoice-tones";

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
 * Canonical record arrangement (Canonical Record Page Primitives).
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

  const sections = [
    { label: "What It Adjusts", href: "#inv-adjustment-lineage-heading" as Route, current: true },
    { label: "Net Change", href: "#inv-adjustment-totals-heading" as Route, current: false },
    ...(adjustment.status !== "voided"
      ? [{ label: "Next Step", href: "#inv-adjustment-steps-heading" as Route, current: false }]
      : []),
    { label: "Documents", href: "#inv-adjustment-exports-heading" as Route, current: false },
    { label: "Changed Lines", href: "#inv-adjustment-lines-heading" as Route, current: false },
    { label: "History", href: "#inv-adjustment-history-heading" as Route, current: false },
  ];
  const attention = attentionLabel(adjustment.attention);

  return (
    // Locked inner-page system (docs/ui-reference/CHELTH-LOCKED-VISUAL-SYSTEM.md).
    <RecordPage>
      <PageHeader
        variant="reference"
        title={adjustment.reference}
        back={
          <Link href={base} className="text-primary underline underline-offset-4">
            Invoices
          </Link>
        }
        description={
          <p>
            {direction} · {adjustment.facilityName} · week{" "}
            {formatPeriod(adjustment.periodStart, adjustment.periodEnd)} · {currency}
          </p>
        }
        meta={
          <>
            <RefChip tone={INVOICE_TONE[adjustment.status]} className="font-semibold">
              {INVOICE_DRAFT_STATUS_LABELS[adjustment.status]}
            </RefChip>
            {attention && adjustment.attention ? (
              <RefChip tone={attentionTone(adjustment.attention)} className="font-semibold">
                {attention}
              </RefChip>
            ) : null}
            <RefChip tone="neutral" className="font-semibold">
              Draft invoice adjustment — internal, not sent
            </RefChip>
            <RecordMeta>Bill-side delta · the original draft never changes · no tax</RecordMeta>
          </>
        }
      />

      <SectionTabs label="Invoice adjustment sections" tabs={sections} />

      {needsStepUp ? (
        <StepUpNotice returnTo={`${base}/adjustments/${adjustment.id}`}>
          Approving, locking and exporting invoice adjustments requires verification with your
          authenticator app.
        </StepUpNotice>
      ) : null}
      {blocked ? (
        <LockedNotice tone="danger" title="Includes revised work" role="alert">
          The timesheet was revised again after this adjustment was prepared, so it cannot be
          approved or locked. Void it and prepare a new adjustment.
        </LockedNotice>
      ) : null}

      <Panel titleId="inv-adjustment-lineage-heading" title={<>What It Adjusts</>}>
        <KeyValueList
          aria-label="Adjustment lineage"
          className="max-w-3xl"
          items={[
            {
              label: "Original draft",
              value: (
                <>
                  <Link
                    href={`${base}/${adjustment.originalDraftId}` as Route}
                    className="text-primary underline underline-offset-4"
                  >
                    {adjustment.originalDraftReference}
                  </Link>{" "}
                  <span className="text-slate-600">(unchanged)</span>
                </>
              ),
            },
            ...(adjustment.previousAdjustmentId
              ? [
                  {
                    label: "Follows",
                    value: (
                      <Link
                        href={`${base}/adjustments/${adjustment.previousAdjustmentId}` as Route}
                        className="text-primary underline underline-offset-4"
                      >
                        {adjustment.previousAdjustmentReference}
                      </Link>
                    ),
                  },
                ]
              : []),
            {
              label: "Revision change",
              value: `Last accounted revision ${adjustment.fromRevision} → priced revision ${adjustment.toRevision}`,
            },
            { label: "Direction", value: direction },
          ]}
        />
      </Panel>

      <Panel titleId="inv-adjustment-totals-heading" title={<>Net Change</>}>
        <KeyValueList
          aria-label="Net bill adjustment"
          className="max-w-xl"
          items={[
            {
              label: "Net (before any tax)",
              value: (
                <SignedAmount
                  minor={adjustment.netDeltaMinor}
                  currency={currency}
                  side="bill"
                  direction={adjustment.direction}
                />
              ),
            },
            {
              label: "Additional charges",
              value: (
                <span className="tabular-nums">
                  {formatSignedMoney(adjustment.totalIncreaseMinor, currency)}
                </span>
              ),
            },
            {
              label: "Credits",
              value: (
                <span className="tabular-nums">
                  {formatSignedMoney(-adjustment.totalDecreaseMinor, currency)}
                </span>
              ),
            },
            {
              label: "Billed time",
              value: (
                <span className="tabular-nums">
                  {formatSignedMinutes(adjustment.deltaPricedMinutes)}
                </span>
              ),
            },
          ]}
        />
        <RecordNote>
          Only the bill-side difference is recorded here; the original draft keeps its amounts.
        </RecordNote>
      </Panel>

      {adjustment.status !== "voided" ? (
        <Panel titleId="inv-adjustment-steps-heading" title={<>Next Step</>}>
          {adjustment.status === "reviewed" && checkerNeeded ? (
            <LockedNotice tone="info" title="Second approver required" role="status">
              You prepared this adjustment. A different finance member must approve it.
            </LockedNotice>
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
          {exportable ? <RecordNote>A locked adjustment never changes.</RecordNote> : null}
        </Panel>
      ) : (
        <LockedNotice tone="info" title="Voided">
          Voided by {adjustment.voidedByName ?? "a former member"}: “{adjustment.voidReason}”.
        </LockedNotice>
      )}

      <Panel titleId="inv-adjustment-exports-heading" title={<>Draft Documents</>}>
        <ExportsTable
          rows={exports}
          canDownload={exportCap === "granted"}
          label="Invoice adjustment exports"
          signedTotals
        />
      </Panel>

      <Panel titleId="inv-adjustment-lines-heading" title={<>Changed Lines</>}>
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
    </RecordPage>
  );
}
