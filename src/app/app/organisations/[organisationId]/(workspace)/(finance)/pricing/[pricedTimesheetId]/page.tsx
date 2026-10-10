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
import { RefChip } from "@/components/reference/locked-reference";
import { RecordMeta, RecordNote, RecordPage } from "@/components/reference/record-page";
import { KeyValueList } from "@/components/ui/key-value-list";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SectionTabs } from "@/components/ui/section-tabs";
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
  formatHoursMinutes,
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
 * without consulting today's configuration. Agency pricing.view only. Canonical
 * record arrangement (Canonical Record Page Primitives).
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
  const superseded = priced.revision < priced.currentRevision;

  const sections = [
    { label: "Summary", href: "#priced-summary-heading" as Route, current: true },
    { label: "Priced Shifts", href: "#priced-shifts-heading" as Route, current: false },
  ];

  return (
    // Locked inner-page system (docs/ui-reference/CHELTH-LOCKED-VISUAL-SYSTEM.md).
    <RecordPage>
      <PageHeader
        variant="reference"
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
          <p>
            Week {formatPeriod(priced.periodStart, priced.periodEnd)} · Timesheet revision{" "}
            {priced.revision}
          </p>
        }
        meta={
          <>
            {superseded ? (
              <RefChip tone="warning" className="font-semibold">
                Superseded by revision {priced.currentRevision}
              </RefChip>
            ) : (
              <RefChip tone="success" className="font-semibold">
                Current snapshot
              </RefChip>
            )}
            <RecordMeta>
              Priced {when.format(new Date(priced.pricedAt))}
              {priced.pricedByName ? ` by ${priced.pricedByName}` : ""} · Calculation version{" "}
              {priced.calculationVersion}
            </RecordMeta>
          </>
        }
      />

      <SectionTabs label="Priced timesheet sections" tabs={sections} />

      <Panel titleId="priced-summary-heading" title={<>Summary</>}>
        <KeyValueList
          aria-label="Totals"
          className="max-w-2xl"
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
            { label: "Currency", value: priced.currency },
            { label: "Lines", value: <span className="tabular-nums">{priced.lineCount}</span> },
          ]}
        />
        <RecordNote>
          This snapshot never changes. A later timesheet revision is priced as a new snapshot.
        </RecordNote>
      </Panel>

      <Panel titleId="priced-shifts-heading" title={<>Priced Shifts</>}>
        <DataTableRegion aria-label="Priced lines">
          <DataTable className="min-w-[960px]">
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
                    <div className="font-medium text-chelth-navy">
                      {dateFormat.format(new Date(`${line.localDate}T00:00:00Z`))}
                    </div>
                    <div className="text-slate-600">
                      {line.facilityName} · {line.disciplineName} ·{" "}
                      {SHIFT_CLASSIFICATION_LABELS[line.classification]}
                    </div>
                  </DataTableCell>
                  <DataTableCell numeric>
                    {formatHoursMinutes(line.rawMinutes)}
                    <div className="text-xs text-slate-600">{line.rawMinutes} min</div>
                  </DataTableCell>
                  <DataTableCell numeric>
                    {line.pricedMinutes} min
                    <div className="text-xs text-slate-600">calculation basis</div>
                    {line.payOvertimeMinutes > 0 ? (
                      <div className="text-xs text-slate-600">
                        {line.payOvertimeMinutes} min pay overtime
                      </div>
                    ) : null}
                    {line.billOvertimeMinutes > 0 ? (
                      <div className="text-xs text-slate-600">
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
                  <DataTableCell className="text-xs text-slate-600">
                    <div>
                      Rate v{line.rateVersion} · {RATE_PRECEDENCE_LABELS[line.ratePrecedence]}
                    </div>
                    <div>{describeRounding(line.roundingMode, line.roundingIncrement)}</div>
                    <div>
                      Pay:{" "}
                      {describeOvertime(line.payOvertimeNumerator, line.payOvertimeDenominator)} ·
                      Bill:{" "}
                      {describeOvertime(line.billOvertimeNumerator, line.billOvertimeDenominator)}
                    </div>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
        </DataTableRegion>
        <RecordNote>
          Amounts: calculation-basis minutes ÷ 60 × hourly rate per line, rounded half up to the
          cent (exact minutes, or rounded first where a rounding policy applied); overtime minutes
          use the configured multiplier. Totals are the sum of lines.
        </RecordNote>
      </Panel>
    </RecordPage>
  );
}
