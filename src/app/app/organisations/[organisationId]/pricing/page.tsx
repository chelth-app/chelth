import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { loadOrganisationPage, requireCapabilityOrNotFound } from "@/features/organisations";
import {
  listPricingQueue,
  PriceTimesheetForm,
  pricingQueueFilterSchema,
  type PricingQueueRow,
} from "@/features/pricing";
import { CAPABILITIES } from "@/lib/authz";
import {
  formatMoney,
  pricingIssueLabel,
  SHIFT_CLASSIFICATION_LABELS,
  type ShiftClassification,
} from "@/lib/domain/pricing";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";

export const metadata: Metadata = { title: "Pricing" };

const TABS = [
  { state: "attention", label: "Needs attention" },
  { state: "ready", label: "Ready for pricing" },
  { state: "priced", label: "Priced" },
] as const;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

/**
 * Financial operations: locked timesheets awaiting pricing, blocked pricing
 * (missing rates first) and priced snapshots. Pricing never pays or invoices.
 */
export default async function PricingPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/pricing">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.PRICING_VIEW);
  const { organisationId, organisation, can } = context;
  if (organisation.type !== "agency") notFound();
  const raw = await searchParams;
  const filter = pricingQueueFilterSchema.parse({
    state: first(raw.state),
    after: first(raw.after),
  });
  const [afterPeriod, afterId] = filter.after ? filter.after.split("_") : [];
  const rows = await listPricingQueue(
    organisationId,
    filter.state,
    afterPeriod && afterId ? { period: afterPeriod, id: afterId } : undefined,
  );
  const canRun = can(CAPABILITIES.PRICING_RUN) === "granted";
  const canSeeRates = can(CAPABILITIES.RATES_VIEW) !== "not_held";
  const last = rows.at(-1);
  const base = `/app/organisations/${organisationId}/pricing` as const;

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          {organisation.name}
        </Link>
        <h1 className="text-2xl font-semibold">Pricing</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Locked timesheets priced with the rates in force on each work date. Worked minutes come
          only from the locked approval. Pricing calculates amounts; it does not pay workers or bill
          facilities.
        </p>
      </header>

      <nav aria-label="Pricing queues" className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.state}
            href={`${base}?state=${tab.state}`}
            aria-current={filter.state === tab.state ? "page" : undefined}
            className={
              filter.state === tab.state
                ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                : "rounded-md border border-input-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-muted"
            }
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {filter.state === "attention"
            ? "No blocked timesheets."
            : filter.state === "ready"
              ? "No locked timesheets are waiting to be priced."
              : "Nothing has been priced yet."}
        </p>
      ) : (
        <div
          role="region"
          aria-label={`${TABS.find((tab) => tab.state === filter.state)?.label ?? "Pricing"} table`}
          tabIndex={0}
          className="overflow-x-auto rounded-lg border border-border bg-surface"
        >
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Worker
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Week
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Facilities
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Worked
                </th>
                {filter.state === "priced" ? (
                  <>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Pay
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Bill
                    </th>
                  </>
                ) : (
                  <th scope="col" className="px-3 py-2 font-medium">
                    Status
                  </th>
                )}
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <QueueRow
                  key={row.pricedTimesheetId ?? row.timesheetId}
                  row={row}
                  organisationId={organisationId}
                  state={filter.state}
                  canRun={canRun}
                  canSeeRates={canSeeRates}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length === 50 && last ? (
        <Link
          href={`${base}?state=${filter.state}&after=${last.periodStart}_${last.pricedTimesheetId ?? last.timesheetId}`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          Next page
        </Link>
      ) : null}
    </>
  );
}

function QueueRow({
  row,
  organisationId,
  state,
  canRun,
  canSeeRates,
}: {
  row: PricingQueueRow;
  organisationId: string;
  state: "attention" | "ready" | "priced";
  canRun: boolean;
  canSeeRates: boolean;
}) {
  const worker = row.workerName ?? "Worker";
  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className="px-3 py-2 font-medium">
        {row.pricedTimesheetId ? (
          <Link
            href={`/app/organisations/${organisationId}/pricing/${row.pricedTimesheetId}`}
            className="text-primary underline underline-offset-4"
          >
            {worker}
          </Link>
        ) : (
          worker
        )}
      </td>
      <td className="px-3 py-2">
        {formatPeriod(row.periodStart, row.periodEnd)}
        {row.revision > 1 ? (
          <div className="text-xs text-muted-foreground">Revision {row.revision}</div>
        ) : null}
      </td>
      <td className="px-3 py-2 text-muted-foreground">{row.facilities.join(", ")}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatWorkedMinutes(row.workedMinutes)}
      </td>
      {state === "priced" ? (
        <>
          <td className="px-3 py-2 text-right tabular-nums">
            {row.currency && row.totalPayMinor !== null
              ? formatMoney(row.totalPayMinor, row.currency)
              : "—"}
          </td>
          <td className="px-3 py-2 text-right tabular-nums">
            {row.currency && row.totalBillMinor !== null
              ? formatMoney(row.totalBillMinor, row.currency)
              : "—"}
            {row.revision < row.currentRevision ? (
              <div className="text-xs text-muted-foreground">
                Superseded by revision {row.currentRevision}
              </div>
            ) : null}
          </td>
        </>
      ) : (
        <td className="px-3 py-2">
          {state === "attention" ? (
            <ul aria-label={`Pricing issues for ${worker}`} className="flex flex-col gap-1">
              {row.issues.map((issue) => (
                <li key={`${issue.entryId}-${issue.code}`} className="flex flex-col">
                  <Badge tone="danger" className="w-fit">
                    {pricingIssueLabel(issue.code)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {issue.localDate}
                    {issue.classification
                      ? ` · ${SHIFT_CLASSIFICATION_LABELS[issue.classification as ShiftClassification] ?? issue.classification}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Badge tone="info">Ready for pricing</Badge>
          )}
        </td>
      )}
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1">
          {state !== "priced" && canRun ? (
            <PriceTimesheetForm
              organisationId={organisationId}
              timesheetId={row.timesheetId}
              revision={row.revision}
              workerName={worker}
              label={state === "attention" ? "Price again" : "Price"}
            />
          ) : null}
          {state === "attention" && canSeeRates ? (
            <Link
              href={`/app/organisations/${organisationId}/rates`}
              className="text-xs text-primary underline underline-offset-4"
            >
              Add or activate a rate
            </Link>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
