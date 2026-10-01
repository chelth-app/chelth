import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

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
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}/pricing?state=priced`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          Pricing
        </Link>
        <h1 className="text-2xl font-semibold">{priced.workerName ?? "Worker"}</h1>
        <p className="text-sm text-muted-foreground">
          Week {formatPeriod(priced.periodStart, priced.periodEnd)} · Timesheet revision{" "}
          {priced.revision}
          {priced.revision < priced.currentRevision
            ? ` (superseded by revision ${priced.currentRevision})`
            : ""}{" "}
          · Priced {when.format(new Date(priced.pricedAt))}
          {priced.pricedByName ? ` by ${priced.pricedByName}` : ""} · Calculation version{" "}
          {priced.calculationVersion}
        </p>
      </header>

      <dl
        aria-label="Totals"
        className="grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm"
      >
        <dt className="text-muted-foreground">Worked (from the locked timesheet)</dt>
        <dd className="tabular-nums">{formatWorkedMinutes(priced.totalRawMinutes)}</dd>
        <dt className="text-muted-foreground">Priced time</dt>
        <dd className="tabular-nums">{formatWorkedMinutes(priced.totalPricedMinutes)}</dd>
        <dt className="text-muted-foreground">Pay</dt>
        <dd className="font-semibold tabular-nums">
          {formatMoney(priced.totalPayMinor, priced.currency)}
        </dd>
        <dt className="text-muted-foreground">Bill</dt>
        <dd className="font-semibold tabular-nums">
          {formatMoney(priced.totalBillMinor, priced.currency)}
        </dd>
        <dt className="text-muted-foreground">Margin (derived)</dt>
        <dd className="tabular-nums">
          {formatMoney(marginMinor(priced.totalBillMinor, priced.totalPayMinor), priced.currency)}
        </dd>
      </dl>

      <div
        role="region"
        aria-label="Priced lines"
        tabIndex={0}
        className="overflow-x-auto rounded-lg border border-border bg-surface"
      >
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Shift
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Worked
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Priced
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Pay rate
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Pay
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Bill rate
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Bill
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Applied
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.lineNumber} className="border-b border-border align-top last:border-0">
                <td className="px-3 py-2">
                  <div className="font-medium">
                    {dateFormat.format(new Date(`${line.localDate}T00:00:00Z`))}
                  </div>
                  <div className="text-muted-foreground">
                    {line.facilityName} · {line.disciplineName} ·{" "}
                    {SHIFT_CLASSIFICATION_LABELS[line.classification]}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{line.rawMinutes} min</td>
                <td className="px-3 py-2 text-right tabular-nums">
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
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatHourlyRate(line.payRateMinor, line.currency)}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {formatMoney(line.payAmountMinor, line.currency)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatHourlyRate(line.billRateMinor, line.currency)}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {formatMoney(line.billAmountMinor, line.currency)}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  <div>
                    Rate v{line.rateVersion} · {RATE_PRECEDENCE_LABELS[line.ratePrecedence]}
                  </div>
                  <div>{describeRounding(line.roundingMode, line.roundingIncrement)}</div>
                  <div>
                    Pay: {describeOvertime(line.payOvertimeNumerator, line.payOvertimeDenominator)}{" "}
                    · Bill:{" "}
                    {describeOvertime(line.billOvertimeNumerator, line.billOvertimeDenominator)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="max-w-3xl text-xs text-muted-foreground">
        Amounts: minutes × hourly rate ÷ 60 per line, rounded half up to the cent; overtime minutes
        use the configured multiplier. Totals are the sum of lines. This snapshot never changes.
      </p>
    </>
  );
}
