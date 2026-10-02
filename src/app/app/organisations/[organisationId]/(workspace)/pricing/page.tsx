import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTablePagination,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTabs } from "@/components/ui/section-tabs";
import { StatusChip } from "@/components/ui/status-chip";
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

import { FinanceModeTabs } from "../_components/finance-mode-tabs";

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

  const currentTab = TABS.find((tab) => tab.state === filter.state) ?? TABS[0];

  return (
    <>
      <PageHeader
        title="Pricing"
        back={
          <Link
            href={`/app/organisations/${organisationId}`}
            className="text-primary underline underline-offset-4"
          >
            {organisation.name}
          </Link>
        }
        description={
          <p>
            Locked timesheets priced with the rates in force on each work date. Worked minutes come
            only from the locked approval. Pricing calculates amounts; it does not pay workers or
            bill facilities.
          </p>
        }
      />

      <FinanceModeTabs organisationId={organisationId} current="pricing" can={can} />

      <SectionTabs
        label="Pricing queues"
        tabs={TABS.map((tab) => ({
          label: tab.label,
          href: `${base}?state=${tab.state}` as Route,
          current: filter.state === tab.state,
        }))}
      />

      {rows.length === 0 ? (
        <EmptyState
          title={
            filter.state === "attention"
              ? "No blocked timesheets."
              : filter.state === "ready"
                ? "No locked timesheets are waiting to be priced."
                : "Nothing has been priced yet."
          }
          description={
            filter.state === "attention"
              ? "Timesheets that cannot be priced, for example because a rate is missing, appear here."
              : filter.state === "ready"
                ? "Timesheets appear here once they are locked after approval."
                : "Priced timesheets appear here with their pay and bill totals."
          }
        />
      ) : (
        <DataTableRegion aria-label={`${currentTab.label} table`}>
          <DataTable className="min-w-[820px]">
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>Worker</DataTableHeaderCell>
                <DataTableHeaderCell>Week</DataTableHeaderCell>
                <DataTableHeaderCell>Facilities</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Worked</DataTableHeaderCell>
                {filter.state === "priced" ? (
                  <>
                    <DataTableHeaderCell numeric>Pay</DataTableHeaderCell>
                    <DataTableHeaderCell numeric>Bill</DataTableHeaderCell>
                  </>
                ) : (
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                )}
                <DataTableHeaderCell>
                  <span className="sr-only">Actions</span>
                </DataTableHeaderCell>
              </tr>
            </DataTableHead>
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
          </DataTable>
        </DataTableRegion>
      )}
      <DataTablePagination
        label="Pricing queue pages"
        nextHref={
          rows.length === 50 && last
            ? (`${base}?state=${filter.state}&after=${last.periodStart}_${last.pricedTimesheetId ?? last.timesheetId}` as Route)
            : null
        }
      />
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
    <DataTableRow>
      <DataTableCell className="font-medium">
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
      </DataTableCell>
      <DataTableCell>
        {formatPeriod(row.periodStart, row.periodEnd)}
        {row.revision > 1 ? (
          <div className="text-xs text-muted-foreground">Revision {row.revision}</div>
        ) : null}
      </DataTableCell>
      <DataTableCell className="text-muted-foreground">{row.facilities.join(", ")}</DataTableCell>
      <DataTableCell numeric>{formatWorkedMinutes(row.workedMinutes)}</DataTableCell>
      {state === "priced" ? (
        <>
          <DataTableCell numeric>
            {row.currency && row.totalPayMinor !== null
              ? formatMoney(row.totalPayMinor, row.currency)
              : "—"}
          </DataTableCell>
          <DataTableCell numeric>
            {row.currency && row.totalBillMinor !== null
              ? formatMoney(row.totalBillMinor, row.currency)
              : "—"}
            {row.revision < row.currentRevision ? (
              <div className="text-xs text-muted-foreground">
                Superseded by revision {row.currentRevision}
              </div>
            ) : null}
          </DataTableCell>
        </>
      ) : (
        <DataTableCell>
          {state === "attention" ? (
            <ul aria-label={`Pricing issues for ${worker}`} className="flex flex-col gap-1">
              {row.issues.map((issue) => (
                <li key={`${issue.entryId}-${issue.code}`} className="flex flex-col">
                  <StatusChip tone="attention" className="w-fit">
                    {pricingIssueLabel(issue.code)}
                  </StatusChip>
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
            <StatusChip tone="info">Ready for pricing</StatusChip>
          )}
        </DataTableCell>
      )}
      <DataTableCell>
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
      </DataTableCell>
    </DataTableRow>
  );
}
