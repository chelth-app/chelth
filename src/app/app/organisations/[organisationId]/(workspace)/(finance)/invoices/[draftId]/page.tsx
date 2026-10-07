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
  getInvoiceDraft,
  HistoryList,
  invoiceDraftStepAction,
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
import { attentionLabel, INVOICE_DRAFT_STATUS_LABELS } from "@/lib/domain/financial";
import { formatHourlyRate, formatMoney } from "@/lib/domain/pricing";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";

import { LockedNotice } from "../../_components/finance-locked";
import { attentionTone, INVOICE_TONE } from "../_components/invoice-tones";

export const metadata: Metadata = { title: "Invoice draft" };

const idSchema = z.uuid();
const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});
const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/**
 * One internal invoice draft: bill side only. No pay rate, pay amount or
 * margin is read, stored or shown for a draft. Canonical record arrangement
 * (Canonical Record Page Primitives); lifecycle steps keep the existing forms
 * and gates, and the database re-checks each one (capability, AAL2,
 * maker-checker).
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
  const [lines, exports, history, settings] = await Promise.all([
    listInvoiceDraftLines(draft.id),
    listFinancialExports("invoice_draft", draft.id),
    listInvoiceDraftHistory(draft.id),
    getFinancialSettings(organisationId),
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

  const sections = [
    { label: "Summary", href: "#draft-summary-heading" as Route, current: true },
    ...(draft.status !== "voided"
      ? [{ label: "Next Step", href: "#draft-steps-heading" as Route, current: false }]
      : []),
    { label: "Documents", href: "#draft-exports-heading" as Route, current: false },
    { label: "Lines", href: "#draft-lines-heading" as Route, current: false },
    { label: "History", href: "#draft-history-heading" as Route, current: false },
  ];
  const step = (at: string | null, by: string | null) =>
    at ? `${when.format(new Date(at))} · ${by ?? "a former member"}` : "—";
  const attention = attentionLabel(draft.attention);

  return (
    // Locked inner-page system (docs/ui-reference/CHELTH-LOCKED-VISUAL-SYSTEM.md).
    <RecordPage>
      <PageHeader
        variant="reference"
        title={draft.reference}
        back={
          <Link href={base} className="text-primary underline underline-offset-4">
            Invoices
          </Link>
        }
        description={
          <p>
            {draft.facilityName} · week {formatPeriod(draft.periodStart, draft.periodEnd)} ·{" "}
            {draft.currency}
          </p>
        }
        meta={
          <>
            <RefChip tone={INVOICE_TONE[draft.status]} className="font-semibold">
              {INVOICE_DRAFT_STATUS_LABELS[draft.status]}
            </RefChip>
            {attention && draft.attention ? (
              <RefChip tone={attentionTone(draft.attention)} className="font-semibold">
                {attention}
              </RefChip>
            ) : null}
            <RefChip tone="neutral" className="font-semibold">
              Draft invoice — internal, not sent
            </RefChip>
            <RecordMeta>No tax calculated · not a request for payment</RecordMeta>
          </>
        }
      />

      <SectionTabs label="Invoice draft sections" tabs={sections} />

      {needsStepUp ? (
        <StepUpNotice returnTo={`${base}/${draft.id}`}>
          Approving, locking, voiding and exporting invoice drafts requires verification with your
          authenticator app.
        </StepUpNotice>
      ) : null}

      {draft.attention === "ADJUSTMENT_REQUIRED" ? (
        <LockedNotice tone="warning" title="Adjustment required" role="status">
          Some billed work was revised after this draft was locked. The draft stays exactly as
          approved; record the difference as an adjustment.
        </LockedNotice>
      ) : null}
      {blocked ? (
        <LockedNotice tone="danger" title="Includes revised work" role="alert">
          Some work in this draft was revised after it was prepared, so it cannot be approved or
          locked. Void the draft and create it again.
        </LockedNotice>
      ) : null}

      <Panel titleId="draft-summary-heading" title={<>Summary</>}>
        <KeyValueList
          aria-label="Draft totals"
          className="max-w-2xl"
          items={[
            {
              label: "Bill total (before any tax)",
              value: (
                <span className="font-semibold tabular-nums">
                  {formatMoney(draft.totalBillMinor, draft.currency)}
                </span>
              ),
            },
            { label: "Lines", value: <span className="tabular-nums">{draft.lineCount}</span> },
            {
              label: "Billed time",
              value: (
                <span className="tabular-nums">
                  {formatWorkedMinutes(draft.totalPricedMinutes)}
                </span>
              ),
            },
            { label: "Facility", value: draft.facilityName },
            { label: "Billing week", value: formatPeriod(draft.periodStart, draft.periodEnd) },
            { label: "Currency", value: draft.currency },
          ]}
        />
        <KeyValueList
          aria-label="Draft lifecycle"
          className="max-w-2xl"
          items={[
            { label: "Prepared", value: step(draft.createdAt, draft.createdByName) },
            { label: "Reviewed", value: step(draft.reviewedAt, draft.reviewedByName) },
            { label: "Approved", value: step(draft.approvedAt, draft.approvedByName) },
            { label: "Locked", value: step(draft.lockedAt, draft.lockedByName) },
            {
              label: "Exported",
              value: draft.exportedAt ? when.format(new Date(draft.exportedAt)) : "—",
            },
          ]}
        />
        <RecordNote>
          Bill amounts are copied exactly from pricing and never recalculated. A locked draft never
          changes; later corrections are prepared as separate adjustments.
        </RecordNote>
      </Panel>

      {draft.status !== "voided" ? (
        <Panel titleId="draft-steps-heading" title={<>Next Step</>}>
          {settings.makerCheckerRequired && ["draft", "reviewed"].includes(draft.status) ? (
            <LockedNotice tone="info" title="Second approver required">
              Prepared by {draft.createdByName ?? "a former member"}. Approval must be completed by
              another eligible member.
            </LockedNotice>
          ) : null}
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
          {exportable ? (
            <RecordNote>
              Locked {draft.lockedAt ? when.format(new Date(draft.lockedAt)) : ""} by{" "}
              {draft.lockedByName ?? "a former member"}. A locked draft never changes.
            </RecordNote>
          ) : null}
        </Panel>
      ) : (
        <LockedNotice tone="info" title="Voided">
          Voided by {draft.voidedByName ?? "a former member"}: “{draft.voidReason}”. The draft is
          unchanged; its work was released for a new draft.
        </LockedNotice>
      )}

      <Panel titleId="draft-exports-heading" title={<>Draft Documents</>}>
        <ExportsTable
          rows={exports}
          canDownload={exportCap === "granted"}
          label="Invoice draft exports"
        />
        <RecordNote>
          Deterministic PDF and CSV files with a SHA-256 checksum, kept in private storage.
          Downloading is recorded. Chelth does not send these documents.
        </RecordNote>
      </Panel>

      <Panel titleId="draft-lines-heading" title={<>Lines</>}>
        <DataTableRegion aria-label="Invoice draft lines">
          <DataTable className="min-w-[760px]">
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>Date</DataTableHeaderCell>
                <DataTableHeaderCell>Worker</DataTableHeaderCell>
                <DataTableHeaderCell>Discipline</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Time</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Bill rate</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Amount</DataTableHeaderCell>
                <DataTableHeaderCell>Source</DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {lines.map((line) => (
                <DataTableRow key={line.lineNumber}>
                  <DataTableCell>
                    {dateFormat.format(new Date(`${line.workDate}T00:00:00Z`))}
                  </DataTableCell>
                  <DataTableCell>
                    <div className="font-medium text-chelth-navy">{line.workerName}</div>
                    {line.workerReference ? (
                      <div className="text-xs text-slate-600">{line.workerReference}</div>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell>{line.disciplineName}</DataTableCell>
                  <DataTableCell numeric>
                    {formatWorkedMinutes(line.pricedMinutes)}
                    {line.billOvertimeMinutes > 0 ? (
                      <div className="text-xs text-slate-600">
                        incl. {formatWorkedMinutes(line.billOvertimeMinutes)} overtime
                      </div>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell numeric>
                    {formatHourlyRate(line.billRateMinor, draft.currency)}
                  </DataTableCell>
                  <DataTableCell numeric>
                    {formatMoney(line.billAmountMinor, draft.currency)}
                  </DataTableCell>
                  <DataTableCell className="text-xs">
                    Revision {line.timesheetRevision}
                    {line.superseded ? (
                      <div className="text-slate-600">Now revision {line.currentRevision}</div>
                    ) : null}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
        </DataTableRegion>
      </Panel>

      <Panel titleId="draft-history-heading" title={<>History</>}>
        <HistoryList rows={history} label="Invoice draft history" />
      </Panel>
    </RecordPage>
  );
}
