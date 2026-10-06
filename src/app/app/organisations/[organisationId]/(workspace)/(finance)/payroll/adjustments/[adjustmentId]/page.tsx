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
  CancelPayrollAdjustmentForm,
  ExportsTable,
  getFinancialSettings,
  getPayrollAdjustment,
  HistoryList,
  listFinancialExports,
  listPayrollAdjustmentHistory,
  listPayrollAdjustmentLines,
  payrollAdjustmentStepAction,
  SignedAmount,
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
  PAYROLL_BATCH_STATUS_LABELS,
} from "@/lib/domain/financial";
import { formatHourlyRate, formatMoney } from "@/lib/domain/pricing";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";

import { LockedNotice } from "../../../_components/finance-locked";
import { attentionTone, PAYROLL_TONE } from "../../_components/payroll-tones";

export const metadata: Metadata = { title: "Payroll adjustment" };

const idSchema = z.uuid();
const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});

function pair(before: string, after: string) {
  return before === after ? after : `${before} → ${after}`;
}

/**
 * One payroll adjustment: the delta between the last accounted revision and
 * the new priced revision, as its own immutable document. Not a payment.
 * Canonical record arrangement (Canonical Record Page Primitives).
 */
export default async function PayrollAdjustmentPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/payroll/adjustments/[adjustmentId]">) {
  const { organisationId: rawOrganisationId, adjustmentId } = await params;
  const context = await loadOrganisationPage(rawOrganisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.PAYROLL_VIEW);
  const { organisationId, can } = context;
  const parsed = idSchema.safeParse(adjustmentId);
  if (!parsed.success) notFound();
  const adjustment = await getPayrollAdjustment(parsed.data);
  if (!adjustment || adjustment.organisationId !== organisationId) notFound();
  const [lines, exports, history, settings] = await Promise.all([
    listPayrollAdjustmentLines(adjustment.id),
    listFinancialExports("payroll_adjustment", adjustment.id),
    listPayrollAdjustmentHistory(adjustment.id),
    getFinancialSettings(organisationId),
  ]);

  const prepare = can(CAPABILITIES.PAYROLL_PREPARE);
  const approve = can(CAPABILITIES.PAYROLL_APPROVE);
  const exportCap = can(CAPABILITIES.PAYROLL_EXPORT);
  const base = `/app/organisations/${organisationId}/payroll` as const;
  const fields = { organisationId, adjustmentId: adjustment.id };
  const blocked = adjustment.attention === "SOURCE_SUPERSEDED";
  const checkerNeeded = settings.makerCheckerRequired && adjustment.preparedByMe;
  const { currency } = adjustment;
  const needsStepUp =
    (["reviewed", "approved"].includes(adjustment.status) && approve === "step_up_required") ||
    (["locked", "exported"].includes(adjustment.status) && exportCap === "step_up_required");

  const sections = [
    { label: "What It Adjusts", href: "#adjustment-lineage-heading" as Route, current: true },
    { label: "Net Change", href: "#adjustment-totals-heading" as Route, current: false },
    ...(adjustment.status !== "cancelled"
      ? [{ label: "Next Step", href: "#adjustment-steps-heading" as Route, current: false }]
      : []),
    { label: "Exports", href: "#adjustment-exports-heading" as Route, current: false },
    { label: "Changed Lines", href: "#adjustment-lines-heading" as Route, current: false },
    { label: "History", href: "#adjustment-history-heading" as Route, current: false },
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
            Payroll
          </Link>
        }
        description={
          <p>
            {adjustment.workerName} · week{" "}
            {formatPeriod(adjustment.periodStart, adjustment.periodEnd)} · {currency}
          </p>
        }
        meta={
          <>
            <RefChip tone={PAYROLL_TONE[adjustment.status]} className="font-semibold">
              {PAYROLL_BATCH_STATUS_LABELS[adjustment.status]}
            </RefChip>
            {attention && adjustment.attention ? (
              <RefChip tone={attentionTone(adjustment.attention)} className="font-semibold">
                {attention}
              </RefChip>
            ) : null}
            <RefChip tone="neutral" className="font-semibold">
              Adjustment — not payment
            </RefChip>
            <RecordMeta>Pay-side delta · the original batch never changes</RecordMeta>
          </>
        }
      />

      <SectionTabs label="Payroll adjustment sections" tabs={sections} />

      {needsStepUp ? (
        <StepUpNotice returnTo={`${base}/adjustments/${adjustment.id}`}>
          Approving, locking and exporting payroll adjustments requires verification with your
          authenticator app.
        </StepUpNotice>
      ) : null}
      {blocked ? (
        <LockedNotice tone="danger" title="Includes revised work" role="alert">
          The timesheet was revised again after this adjustment was prepared, so it cannot be
          approved or locked. Cancel it and prepare a new adjustment.
        </LockedNotice>
      ) : null}

      <Panel titleId="adjustment-lineage-heading" title={<>What It Adjusts</>}>
        <KeyValueList
          aria-label="Adjustment lineage"
          className="max-w-3xl"
          items={[
            {
              label: "Original batch",
              value: (
                <>
                  <Link
                    href={`${base}/${adjustment.originalBatchId}` as Route}
                    className="text-primary underline underline-offset-4"
                  >
                    {adjustment.originalBatchReference}
                  </Link>{" "}
                  <span className="text-muted-foreground">(unchanged)</span>
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
              value: (
                <>
                  Last accounted revision {adjustment.fromRevision} → priced revision{" "}
                  {adjustment.toRevision}
                  {adjustment.currentRevision !== adjustment.toRevision ? (
                    <span className="text-muted-foreground">
                      {" "}
                      (timesheet is now at revision {adjustment.currentRevision})
                    </span>
                  ) : null}
                </>
              ),
            },
            {
              label: "Source pricing",
              value: (
                <>
                  <Link
                    href={
                      `/app/organisations/${organisationId}/pricing/${adjustment.fromPricedTimesheetId}` as Route
                    }
                    className="text-primary underline underline-offset-4"
                  >
                    Revision {adjustment.fromRevision}
                  </Link>{" "}
                  ·{" "}
                  <Link
                    href={
                      `/app/organisations/${organisationId}/pricing/${adjustment.toPricedTimesheetId}` as Route
                    }
                    className="text-primary underline underline-offset-4"
                  >
                    Revision {adjustment.toRevision}
                  </Link>
                </>
              ),
            },
          ]}
        />
      </Panel>

      <Panel titleId="adjustment-totals-heading" title={<>Net Change</>}>
        <KeyValueList
          aria-label="Net pay change"
          className="max-w-xl"
          items={[
            {
              label: "Net pay change",
              value: (
                <SignedAmount minor={adjustment.netDeltaMinor} currency={currency} side="pay" />
              ),
            },
            {
              label: "Increases",
              value: (
                <span className="tabular-nums">
                  {formatSignedMoney(adjustment.totalIncreaseMinor, currency)}
                </span>
              ),
            },
            {
              label: "Decreases",
              value: (
                <span className="tabular-nums">
                  {formatSignedMoney(-adjustment.totalDecreaseMinor, currency)}
                </span>
              ),
            },
            {
              label: "Regular time",
              value: (
                <span className="tabular-nums">
                  {formatSignedMinutes(adjustment.deltaRegularMinutes)}
                </span>
              ),
            },
            {
              label: "Overtime",
              value: (
                <span className="tabular-nums">
                  {formatSignedMinutes(adjustment.deltaOvertimeMinutes)}
                </span>
              ),
            },
            {
              label: "Changed lines",
              value: <span className="tabular-nums">{adjustment.lineCount}</span>,
            },
          ]}
        />
      </Panel>

      {adjustment.status !== "cancelled" ? (
        <Panel titleId="adjustment-steps-heading" title={<>Next Step</>}>
          {adjustment.status === "reviewed" && checkerNeeded ? (
            <LockedNotice tone="info" title="Second approver required" role="status">
              You prepared this adjustment. A different finance member must approve it.
            </LockedNotice>
          ) : null}
          <div className="flex flex-wrap items-start gap-3">
            {adjustment.status === "draft" && prepare === "granted" ? (
              <InlineActionForm
                action={payrollAdjustmentStepAction}
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
                action={payrollAdjustmentStepAction}
                fields={{ ...fields, step: "approve" }}
                label="Approve adjustment"
                variant="primary"
              />
            ) : null}
            {adjustment.status === "approved" && approve === "granted" && !blocked ? (
              <InlineActionForm
                action={payrollAdjustmentStepAction}
                fields={{ ...fields, step: "lock" }}
                label="Lock adjustment"
                variant="primary"
              />
            ) : null}
            {["locked", "exported"].includes(adjustment.status) && exportCap === "granted" ? (
              <InlineActionForm
                action={payrollAdjustmentStepAction}
                fields={{ ...fields, step: "export" }}
                label={adjustment.status === "locked" ? "Export CSV" : "Export CSV again"}
                variant={adjustment.status === "locked" ? "primary" : "outline"}
              />
            ) : null}
            {(["draft", "reviewed"].includes(adjustment.status) && prepare === "granted") ||
            (adjustment.status === "approved" && approve === "granted") ? (
              <CancelPayrollAdjustmentForm
                organisationId={organisationId}
                adjustmentId={adjustment.id}
              />
            ) : null}
          </div>
          {["locked", "exported"].includes(adjustment.status) ? (
            <RecordNote>
              Locked by {adjustment.lockedByName ?? "a former member"}. A locked adjustment never
              changes.
            </RecordNote>
          ) : null}
        </Panel>
      ) : (
        <LockedNotice tone="info" title="Cancelled">
          Cancelled by {adjustment.cancelledByName ?? "a former member"}: “{adjustment.cancelReason}
          ”. The revision change can be adjusted again.
        </LockedNotice>
      )}

      <Panel titleId="adjustment-exports-heading" title={<>Exports</>}>
        <ExportsTable
          rows={exports}
          canDownload={exportCap === "granted"}
          label="Payroll adjustment exports"
          signedTotals
        />
      </Panel>

      <Panel titleId="adjustment-lines-heading" title={<>Changed Lines</>}>
        <DataTableRegion aria-label="Payroll adjustment lines">
          <DataTable className="min-w-[920px]">
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>Date</DataTableHeaderCell>
                <DataTableHeaderCell>Facility · discipline</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Time (original → revised)</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Pay rate</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Pay (original → revised)</DataTableHeaderCell>
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
                    {line.facilityName} · {line.disciplineName}
                  </DataTableCell>
                  <DataTableCell numeric>
                    {pair(
                      line.oldRegularMinutes === null
                        ? "—"
                        : formatWorkedMinutes(
                            (line.oldRegularMinutes ?? 0) + (line.oldOvertimeMinutes ?? 0),
                          ),
                      line.newRegularMinutes === null
                        ? "—"
                        : formatWorkedMinutes(
                            (line.newRegularMinutes ?? 0) + (line.newOvertimeMinutes ?? 0),
                          ),
                    )}
                  </DataTableCell>
                  <DataTableCell numeric>
                    {pair(
                      line.oldPayRateMinor === null
                        ? "—"
                        : formatHourlyRate(line.oldPayRateMinor, currency),
                      line.newPayRateMinor === null
                        ? "—"
                        : formatHourlyRate(line.newPayRateMinor, currency),
                    )}
                  </DataTableCell>
                  <DataTableCell numeric>
                    {line.oldPayAmountMinor === null
                      ? "—"
                      : formatMoney(line.oldPayAmountMinor, currency)}{" "}
                    →{" "}
                    {line.newPayAmountMinor === null
                      ? "—"
                      : formatMoney(line.newPayAmountMinor, currency)}
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    <SignedAmount minor={line.deltaPayAmountMinor} currency={currency} side="pay" />
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
        </DataTableRegion>
      </Panel>

      <Panel titleId="adjustment-history-heading" title={<>History</>}>
        <HistoryList rows={history} label="Payroll adjustment history" />
      </Panel>
    </RecordPage>
  );
}
