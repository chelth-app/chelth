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
import { KeyValueList } from "@/components/ui/key-value-list";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        title={draft.reference}
        back={
          <Link href={base} className="text-primary underline underline-offset-4">
            Invoices
          </Link>
        }
        description={
          <p className="text-sm">
            {draft.facilityName} · week {formatPeriod(draft.periodStart, draft.periodEnd)} ·{" "}
            {draft.currency} · No tax calculated. Not a request for payment.
          </p>
        }
        meta={
          <>
            <Badge tone="neutral">Draft invoice — internal, not sent</Badge>
            <InvoiceStatusBadge status={draft.status} />
            <AttentionBadge code={draft.attention} />
            <Badge tone="neutral">{draft.currency}</Badge>
          </>
        }
      />

      {needsStepUp ? (
        <StepUpNotice returnTo={`${base}/${draft.id}`}>
          Approving, locking, voiding and exporting invoice drafts requires verification with your
          authenticator app.
        </StepUpNotice>
      ) : null}

      {draft.attention === "ADJUSTMENT_REQUIRED" ? (
        <p
          role="status"
          className="rounded-md border border-border bg-warning-soft p-3 text-sm text-warning-soft-foreground"
        >
          Adjustment required: some billed work was revised after this draft was locked. The draft
          stays exactly as approved; record the difference as an adjustment.
        </p>
      ) : null}
      {blocked ? (
        <p
          role="alert"
          className="rounded-md border border-border bg-danger-soft p-3 text-sm text-danger-soft-foreground"
        >
          Some work in this draft was revised after it was prepared, so it cannot be approved or
          locked. Void the draft and create it again.
        </p>
      ) : null}

      <Panel titleId="draft-totals-heading" title={<>Totals</>}>
        <KeyValueList
          aria-label="Draft totals"
          className="max-w-xl"
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
          ]}
        />
      </Panel>

      {draft.status !== "voided" ? (
        <Panel titleId="draft-steps-heading" title={<>Next step</>}>
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
        </Panel>
      ) : (
        <p className="text-sm text-muted-foreground">
          Voided by {draft.voidedByName ?? "a former member"}: “{draft.voidReason}”. The draft is
          unchanged; its work was released for a new draft.
        </p>
      )}

      <Panel titleId="draft-exports-heading" title={<>Draft documents</>}>
        <ExportsTable
          rows={exports}
          canDownload={exportCap === "granted"}
          label="Invoice draft exports"
        />
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
                    {line.workerName}
                    {line.workerReference ? (
                      <div className="text-xs text-muted-foreground">{line.workerReference}</div>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell>{line.disciplineName}</DataTableCell>
                  <DataTableCell numeric>
                    {formatWorkedMinutes(line.pricedMinutes)}
                    {line.billOvertimeMinutes > 0 ? (
                      <div className="text-xs text-muted-foreground">
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
                      <div className="text-muted-foreground">
                        Now revision {line.currentRevision}
                      </div>
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
    </>
  );
}
