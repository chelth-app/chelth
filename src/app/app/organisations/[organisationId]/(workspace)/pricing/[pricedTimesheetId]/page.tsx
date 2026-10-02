import type { Metadata } from "next";
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
import { KeyValueList } from "@/components/ui/key-value-list";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { loadOrganisationPage, requireCapabilityOrNotFound } from "@/features/organisations";
import { getPricedTimesheet, listPricedLines } from "@/features/pricing";
import { CAPABILITIES } from "@/lib/authz";
import {
  describeOvertime,
  describeRounding,
  formatHourlyRate,
  formatMoney,
  marginMinor,
  RATE_PRECEDENCE_LABELS,
  SHIFT_CLASSIFICATION_LABELS,
} from "@/lib/domain/pricing";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";

export const metadata: Metadata = { title: "Priced timesheet" };

const idSchema = z.uuid();
const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});
const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/**
 * An immutable pricing snapshot: every line shows its minutes, the applied
 * rate version and policies, and the resulting amounts — explainable later
 * without consulting today's configuration. Agency pricing.view only.
 */
export default async function PricedTimesheetPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/pricing/[pricedTimesheetId]">) {
  const { organisationId: rawOrganisationId, pricedTimesheetId } = await params;
  const context = await loadOrganisationPage(rawOrganisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.PRICING_VIEW);
  const { organisationId } = context;
  const parsed = idSchema.safeParse(pricedTimesheetId);
  if (!parsed.success) notFound();
  const priced = await getPricedTimesheet(parsed.data);
  if (!priced || priced.organisationId !== organisationId) notFound();
  const lines = await listPricedLines(priced.id);

  return (
    <>
      <PageHeader
        title={priced.workerName ?? "Worker"}
        back={
          <Link
            href={`/app/organisations/${organisationId}/pricing?state=priced`}
            className="text-primary underline underline-offset-4"
          >
            Pricing
          </Link>
        }
        description={
          <p className="text-sm">
            Week {formatPeriod(priced.periodStart, priced.periodEnd)} · Timesheet revision{" "}
            {priced.revision}
            {priced.revision < priced.currentRevision
              ? ` (superseded by revision ${priced.currentRevision})`
              : ""}{" "}
            · Priced {when.format(new Date(priced.pricedAt))}
            {priced.pricedByName ? ` by ${priced.pricedByName}` : ""} · Calculation version{" "}
            {priced.calculationVersion}
          </p>
        }
        meta={
          priced.revision < priced.currentRevision ? (
            <StatusChip tone="warning">Superseded</StatusChip>
          ) : (
            <StatusChip tone="success">Current snapshot</StatusChip>
          )
        }
      />

      <div className="flex max-w-xl flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="font-display text-lg font-semibold">Totals</h2>
        <KeyValueList
          aria-label="Totals"
          items={[
            {
              label: "Worked (from the locked timesheet)",
              value: (
                <span className="tabular-nums">{formatWorkedMinutes(priced.totalRawMinutes)}</span>
              ),
            },
            {
              label: "Priced time",
              value: (
                <span className="tabular-nums">
                  {formatWorkedMinutes(priced.totalPricedMinutes)}
                </span>
              ),
            },
            {
              label: "Pay",
              value: (
                <span className="font-semibold tabular-nums">
                  {formatMoney(priced.totalPayMinor, priced.currency)}
                </span>
              ),
            },
            {
              label: "Bill",
              value: (
                <span className="font-semibold tabular-nums">
                  {formatMoney(priced.totalBillMinor, priced.currency)}
                </span>
              ),
            },
            {
              label: "Margin (derived)",
              value: (
                <span className="tabular-nums">
                  {formatMoney(
                    marginMinor(priced.totalBillMinor, priced.totalPayMinor),
                    priced.currency,
                  )}
                </span>
              ),
            },
          ]}
        />
      </div>

      <h2 className="font-display text-lg font-semibold">Priced lines</h2>
      <DataTableRegion aria-label="Priced lines">
        <DataTable className="min-w-[1040px]">
          <DataTableHead>
            <tr>
              <DataTableHeaderCell>Shift</DataTableHeaderCell>
              <DataTableHeaderCell numeric>Worked</DataTableHeaderCell>
              <DataTableHeaderCell numeric>Priced</DataTableHeaderCell>
              <DataTableHeaderCell numeric>Pay rate</DataTableHeaderCell>
              <DataTableHeaderCell numeric>Pay</DataTableHeaderCell>
              <DataTableHeaderCell numeric>Bill rate</DataTableHeaderCell>
              <DataTableHeaderCell numeric>Bill</DataTableHeaderCell>
              <DataTableHeaderCell>Applied</DataTableHeaderCell>
            </tr>
          </DataTableHead>
          <tbody>
            {lines.map((line) => (
              <DataTableRow key={line.lineNumber}>
                <DataTableCell>
                  <div className="font-medium">
                    {dateFormat.format(new Date(`${line.localDate}T00:00:00Z`))}
                  </div>
                  <div className="text-muted-foreground">
                    {line.facilityName} · {line.disciplineName} ·{" "}
                    {SHIFT_CLASSIFICATION_LABELS[line.classification]}
                  </div>
                </DataTableCell>
                <DataTableCell numeric>{line.rawMinutes} min</DataTableCell>
                <DataTableCell numeric>
                  {line.pricedMinutes} min
                  {line.payOvertimeMinutes > 0 ? (
                    <div className="text-xs text-muted-foreground">
                      {line.payOvertimeMinutes} min pay overtime
                    </div>
                  ) : null}
                  {line.billOvertimeMinutes > 0 ? (
                    <div className="text-xs text-muted-foreground">
                      {line.billOvertimeMinutes} min bill overtime
                    </div>
                  ) : null}
                </DataTableCell>
                <DataTableCell numeric>
                  {formatHourlyRate(line.payRateMinor, line.currency)}
                </DataTableCell>
                <DataTableCell numeric className="font-medium">
                  {formatMoney(line.payAmountMinor, line.currency)}
                </DataTableCell>
                <DataTableCell numeric>
                  {formatHourlyRate(line.billRateMinor, line.currency)}
                </DataTableCell>
                <DataTableCell numeric className="font-medium">
                  {formatMoney(line.billAmountMinor, line.currency)}
                </DataTableCell>
                <DataTableCell className="text-xs text-muted-foreground">
                  <div>
                    Rate v{line.rateVersion} · {RATE_PRECEDENCE_LABELS[line.ratePrecedence]}
                  </div>
                  <div>{describeRounding(line.roundingMode, line.roundingIncrement)}</div>
                  <div>
                    Pay: {describeOvertime(line.payOvertimeNumerator, line.payOvertimeDenominator)}{" "}
                    · Bill:{" "}
                    {describeOvertime(line.billOvertimeNumerator, line.billOvertimeDenominator)}
                  </div>
                </DataTableCell>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      </DataTableRegion>
      <p className="max-w-3xl text-xs text-muted-foreground">
        Amounts: minutes × hourly rate ÷ 60 per line, rounded half up to the cent; overtime minutes
        use the configured multiplier. Totals are the sum of lines. This snapshot never changes.
      </p>
    </>
  );
}
