import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import {
  InitialsAvatar,
  KpiNote,
  REF_TABLE,
  REF_TEXT,
  RefChip,
  RefKpiCard,
  RefPanel,
} from "@/components/reference/locked-reference";
import {
  RECORD_ROW,
  RECORD_ROW_META,
  RECORD_ROW_TITLE,
  RecordList,
} from "@/components/reference/record-page";
import { DataTablePagination, DataTableRegion } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SectionTabs } from "@/components/ui/section-tabs";
import { loadOrganisationPage, requireCapabilityOrNotFound } from "@/features/organisations";
import {
  listPricingQueue,
  listRateCards,
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
import { todayIsoDate } from "@/lib/domain/shifts";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";
import { cn } from "@/lib/utils/cn";

import { LockedEmpty, LockedTile } from "../_components/finance-locked";
import { summarise } from "../rates/_components/rate-card-summary";

export const metadata: Metadata = { title: "Pricing" };

const TABS = [
  { state: "attention", label: "Needs attention", heading: "Needs Attention" },
  { state: "ready", label: "Ready for pricing", heading: "Ready for Pricing" },
  { state: "priced", label: "Priced", heading: "Priced Timesheets" },
] as const;
type QueueState = (typeof TABS)[number]["state"];

/** The engine's precedence (pricing_engine.sql, internal.resolve_rate), most specific first. */
const TIERS = [
  {
    tier: 1,
    title: "Facility + discipline + shift type",
    note: "A rate card for this facility relationship, discipline and shift type.",
  },
  {
    tier: 2,
    title: "Facility + discipline, any shift type",
    note: "A rate card for this facility relationship and discipline.",
  },
  {
    tier: 3,
    title: "All facilities + discipline + shift type",
    note: "An agency-wide rate card for this discipline and shift type.",
  },
  {
    tier: 4,
    title: "All facilities + discipline, any shift type",
    note: "An agency-wide rate card for this discipline.",
  },
] as const;

const PAGE_SIZE = 50;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

/** Count of a capped list ("50+" when the page is full). */
function capped(count: number): string {
  return count >= PAGE_SIZE ? `${PAGE_SIZE}+` : String(count);
}

/**
 * Pricing (locked Rates + Pricing reference, on the locked Chelth system):
 * how Chelth resolves the rate for worked time, and the locked timesheets
 * waiting to be priced, blocked or priced. Pricing calculates amounts from
 * the rate version in force on each work date; it never pays or invoices.
 * Figures count the queues as loaded (first 50 each).
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
  const canRun = can(CAPABILITIES.PRICING_RUN) === "granted";
  const canSeeRates = can(CAPABILITIES.RATES_VIEW) !== "not_held";
  const readRates = can(CAPABILITIES.RATES_VIEW) === "granted";

  const [attention, ready, priced, cards] = await Promise.all([
    listPricingQueue(organisationId, "attention"),
    listPricingQueue(organisationId, "ready"),
    listPricingQueue(organisationId, "priced"),
    readRates ? listRateCards(organisationId) : Promise.resolve(null),
  ]);
  const queues: Record<QueueState, PricingQueueRow[]> = { attention, ready, priced };
  const rows =
    afterPeriod && afterId
      ? await listPricingQueue(organisationId, filter.state, { period: afterPeriod, id: afterId })
      : queues[filter.state];

  const today = todayIsoDate();
  const summaries = cards?.map((card) => summarise(card, today)) ?? null;
  const missingRates = attention
    .flatMap((row) => row.issues)
    .filter((issue) => issue.code === "RATE_NOT_CONFIGURED").length;
  const superseded = priced.filter((row) => row.revision < row.currentRevision).length;
  const inForce = summaries?.filter((summary) => summary.state === "active").length ?? 0;
  const notInForce = summaries ? summaries.length - inForce : 0;
  const tierCount = (tier: number) =>
    summaries?.filter((summary) => summary.tier === tier).length ?? 0;

  const last = rows.at(-1);
  const orgBase = `/app/organisations/${organisationId}` as const;
  const base = `${orgBase}/pricing` as const;
  const currentTab = TABS.find((tab) => tab.state === filter.state) ?? TABS[0];
  const quick = (state: QueueState) => ({
    href: `${base}?state=${state}` as Route,
    active: filter.state === state,
  });

  return (
    <div className="chelth-locked flex flex-col gap-[13px]">
      <PageHeader
        variant="reference"
        className="xl:mb-1"
        title="Pricing"
        description={
          <p>
            How Chelth determines the pay and bill rates for approved work, and the timesheets
            waiting to be priced.
          </p>
        }
      />

      <section
        aria-label="Pricing summary"
        className={cn(
          "grid grid-cols-2 gap-3 xl:gap-[13px]",
          summaries ? "xl:grid-cols-4" : "xl:grid-cols-3",
        )}
      >
        <RefKpiCard
          label="Needs Attention"
          value={capped(attention.length)}
          supporting="Cannot be priced yet"
          footer={
            <KpiNote tone="danger">
              {missingRates === 1 ? "1 missing rate" : `${missingRates} missing rates`}
            </KpiNote>
          }
          glyph="alert"
          icon={<WorkspaceNavIcon name="requests" strokeWidth={2.25} duotone />}
          tone="danger"
          {...quick("attention")}
        />
        <RefKpiCard
          label="Ready for Pricing"
          value={capped(ready.length)}
          supporting="Locked after approval"
          footer={<KpiNote tone="warning">Waiting to be priced</KpiNote>}
          glyph="clock"
          icon={<WorkspaceNavIcon name="timesheets" strokeWidth={2.25} duotone />}
          tone="warning"
          {...quick("ready")}
        />
        <RefKpiCard
          label="Priced"
          value={capped(priced.length)}
          supporting="Snapshots kept unchanged"
          footer={<KpiNote tone="info">{superseded} superseded by a revision</KpiNote>}
          glyph="document"
          icon={<WorkspaceNavIcon name="pricing" strokeWidth={2.25} duotone />}
          tone="teal"
          {...quick("priced")}
        />
        {summaries ? (
          <RefKpiCard
            label="Rate Cards in Force"
            value={inForce}
            supporting={
              summaries.length === 1 ? "Of 1 rate card" : `Of ${summaries.length} rate cards`
            }
            footer={
              <KpiNote tone={notInForce > 0 ? "warning" : "success"}>
                {notInForce} with no rate in force
              </KpiNote>
            }
            glyph="document"
            icon={<WorkspaceNavIcon name="rates" strokeWidth={2.25} duotone />}
            tone="info"
            href={`${orgBase}/rates` as Route}
          />
        ) : null}
      </section>

      {/* The engine's precedence, explained (Settings explanatory pattern). */}
      <Panel
        titleId="rate-matching-heading"
        title={<>How Rates Are Matched</>}
        description={
          <>
            For each worked shift, Chelth checks these levels in order. The first level with a
            matching rate card decides the rate.
          </>
        }
        action={
          canSeeRates ? (
            <Link
              href={`${orgBase}/rates` as Route}
              className="inline-flex min-h-11 items-center gap-2 rounded-[8px] border border-[rgba(0,90,96,0.35)] bg-white px-4 text-[14px] font-semibold text-chelth-navy shadow-[0_1px_2px_rgba(13,47,66,0.05)] hover:border-chelth-teal-dark hover:bg-[#f4fbf9]"
            >
              <WorkspaceNavIcon
                name="rates"
                strokeWidth={2.1}
                className="size-[18px] text-chelth-teal-dark"
              />
              Manage rate cards
            </Link>
          ) : undefined
        }
      >
        <RecordList label="Rate matching order">
          {TIERS.map((tier) => (
            <li key={tier.tier} className={RECORD_ROW}>
              <LockedTile>{tier.tier}</LockedTile>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={RECORD_ROW_TITLE}>{tier.title}</span>
                <span className={RECORD_ROW_META}>{tier.note}</span>
              </span>
              {summaries ? (
                <RefChip tone="neutral" className="font-normal">
                  {tierCount(tier.tier) === 1
                    ? "1 rate card"
                    : `${tierCount(tier.tier)} rate cards`}
                </RefChip>
              ) : null}
            </li>
          ))}
        </RecordList>
        <div className="flex items-start gap-3 rounded-[10px] border border-[rgba(180,120,20,0.10)] bg-warning-soft/40 px-3.5 py-3">
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-warning-indicator text-white"
          >
            <svg
              viewBox="0 0 16 16"
              className="size-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
            >
              <path d="M8 4.5v4.5M8 11.5v.01" strokeLinecap="round" />
            </svg>
          </span>
          <span className="flex flex-col">
            <span className="text-[14px] leading-5 font-medium text-chelth-navy">
              No fallback to a broader rate
            </span>
            <span className="text-[12.5px] leading-[18px] text-slate-600">
              If the first matching rate card has no version in force on the work date, the
              timesheet waits in Needs attention. Priced timesheets keep the rates they were priced
              with.
            </span>
          </span>
        </div>
      </Panel>

      <SectionTabs
        label="Pricing queues"
        tabs={TABS.map((tab) => ({
          label: tab.label,
          href: `${base}?state=${tab.state}` as Route,
          current: filter.state === tab.state,
        }))}
      />

      <RefPanel
        title={currentTab.heading}
        titleId="pricing-queue-heading"
        action={
          <span className="text-[13.5px] text-muted-foreground">
            {rows.length === 1 ? "1 timesheet" : `${rows.length} timesheets`}
          </span>
        }
      >
        {rows.length === 0 ? (
          <LockedEmpty
            icon="pricing"
            title={
              filter.state === "attention"
                ? "No blocked timesheets."
                : filter.state === "ready"
                  ? "No locked timesheets are waiting to be priced."
                  : "Nothing has been priced yet."
            }
            note={
              filter.state === "attention"
                ? "Timesheets that cannot be priced, for example because a rate is missing, appear here."
                : filter.state === "ready"
                  ? "Timesheets appear here once they are locked after approval."
                  : "Priced timesheets appear here with their pay and bill totals."
            }
          />
        ) : (
          <DataTableRegion
            aria-label={`${currentTab.label} table`}
            className="mt-[9px] rounded-none border-0 bg-transparent"
          >
            <table className={cn(REF_TABLE, "min-w-[860px]")}>
              <thead className={REF_TEXT.tableHead}>
                <tr>
                  <th scope="col">Worker</th>
                  <th scope="col">Week</th>
                  <th scope="col">Facilities</th>
                  <th scope="col" className="text-right">
                    Worked
                  </th>
                  {filter.state === "priced" ? (
                    <>
                      <th scope="col" className="text-right">
                        Pay
                      </th>
                      <th scope="col" className="text-right">
                        Bill
                      </th>
                    </>
                  ) : (
                    <th scope="col">Status</th>
                  )}
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className={REF_TEXT.tableBody}>
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
          </DataTableRegion>
        )}
        <DataTablePagination
          label="Pricing queue pages"
          nextHref={
            rows.length === PAGE_SIZE && last
              ? (`${base}?state=${filter.state}&after=${last.periodStart}_${last.pricedTimesheetId ?? last.timesheetId}` as Route)
              : null
          }
        />
      </RefPanel>
    </div>
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
  state: QueueState;
  canRun: boolean;
  canSeeRates: boolean;
}) {
  const worker = row.workerName ?? "Worker";
  return (
    <tr className="h-[42px] transition-colors hover:bg-surface-muted/50">
      <td>
        <span className="flex items-center gap-2.5">
          <InitialsAvatar name={row.workerName} />
          {row.pricedTimesheetId ? (
            <Link
              href={`/app/organisations/${organisationId}/pricing/${row.pricedTimesheetId}`}
              className="truncate font-medium text-chelth-navy hover:text-primary hover:underline hover:underline-offset-4"
            >
              {worker}
            </Link>
          ) : (
            <span className="truncate font-medium text-chelth-navy">{worker}</span>
          )}
        </span>
      </td>
      <td className="whitespace-nowrap">
        {formatPeriod(row.periodStart, row.periodEnd)}
        {row.revision > 1 ? (
          <span className="block text-[11.5px] text-muted-foreground">Revision {row.revision}</span>
        ) : null}
      </td>
      <td>{row.facilities.join(", ") || "—"}</td>
      <td className="text-right whitespace-nowrap tabular-nums">
        {formatWorkedMinutes(row.workedMinutes)}
      </td>
      {state === "priced" ? (
        <>
          <td className="text-right whitespace-nowrap tabular-nums">
            {row.currency && row.totalPayMinor !== null
              ? formatMoney(row.totalPayMinor, row.currency)
              : "—"}
          </td>
          <td className="text-right whitespace-nowrap tabular-nums">
            {row.currency && row.totalBillMinor !== null
              ? formatMoney(row.totalBillMinor, row.currency)
              : "—"}
            {row.revision < row.currentRevision ? (
              <span className="block text-[11.5px] text-muted-foreground">
                Superseded by revision {row.currentRevision}
              </span>
            ) : null}
          </td>
        </>
      ) : (
        <td>
          {state === "attention" ? (
            <ul aria-label={`Pricing issues for ${worker}`} className="flex flex-col gap-1 py-2">
              {row.issues.map((issue) => (
                <li key={`${issue.entryId}-${issue.code}`} className="flex flex-col items-start">
                  <RefChip tone="danger" className="font-normal">
                    {pricingIssueLabel(issue.code)}
                  </RefChip>
                  <span className="text-[11.5px] text-muted-foreground">
                    {issue.localDate}
                    {issue.classification
                      ? ` · ${SHIFT_CLASSIFICATION_LABELS[issue.classification as ShiftClassification] ?? issue.classification}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <RefChip tone="warning" className="font-normal">
              Ready for pricing
            </RefChip>
          )}
        </td>
      )}
      <td>
        <div className="flex flex-col items-start gap-1 py-1.5">
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
              href={`/app/organisations/${organisationId}/rates?status=attention`}
              className="inline-flex min-h-6 items-center text-[12px] font-medium text-primary underline underline-offset-4"
            >
              Add or activate a rate
            </Link>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
