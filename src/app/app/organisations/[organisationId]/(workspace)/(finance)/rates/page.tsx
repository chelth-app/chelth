import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import {
  KpiNote,
  REF_CARD_FROSTED,
  REF_TABLE,
  REF_TEXT,
  RefChip,
  RefKpiCard,
  RefPanel,
} from "@/components/reference/locked-reference";
import { RecordNote } from "@/components/reference/record-page";
import { DataTableRegion } from "@/components/ui/data-table";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { LocationPin } from "@/components/ui/location-pin";
import { PageHeader } from "@/components/ui/page-header";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import {
  listPricingPolicies,
  listRateCards,
  listRateScopeOptions,
  NewRateForm,
  OvertimePolicyForm,
  rateCardCursorSchema,
  RoundingPolicyForm,
  setPolicyStatusAction,
} from "@/features/pricing";
import { CAPABILITIES } from "@/lib/authz";
import {
  describeOvertime,
  describeRounding,
  formatHourlyRate,
  SHIFT_CLASSIFICATION_LABELS,
  SHIFT_CLASSIFICATIONS,
} from "@/lib/domain/pricing";
import { todayIsoDate } from "@/lib/domain/shifts";
import { cn } from "@/lib/utils/cn";

import { HeaderAddAction, LockedEmpty, LockedFilterSelect } from "../_components/finance-locked";
import {
  addIsoDays,
  CARD_FILTER_LABELS,
  CARD_FILTERS,
  CARD_STATE_LABELS,
  CARD_STATE_TONE,
  type CardFilter,
  matchesFilter,
  rateDay,
  summarise,
} from "./_components/rate-card-summary";
import { RateDetailsPanel } from "./_components/rate-details-panel";

export const metadata: Metadata = { title: "Rates" };

const ALL_FACILITIES = "all";
const ANY_SHIFT_TYPE = "any";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

/**
 * Agency rate cards (locked Rates reference, on the locked Chelth system).
 * Versions are never edited once active: a new version supersedes the current
 * one from its start date. Money is shown in the version's own currency. Every
 * figure is a count over the rate cards loaded for this page; the filters
 * narrow that list (no new query). Resolution itself stays in the database.
 */
export default async function RatesPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/rates">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.RATES_VIEW);
  const { organisationId, organisation, can } = context;
  if (organisation.type !== "agency") notFound();
  const manage = can(CAPABILITIES.RATES_MANAGE);
  const canManage = manage === "granted";
  const canSeePricing = can(CAPABILITIES.PRICING_VIEW) !== "not_held";

  const raw = await searchParams;
  const rawAfter = first(raw.after);
  // `show` is the earlier name of the draft / upcoming quick filters.
  const rawStatus = first(raw.status) ?? first(raw.show);
  const status = CARD_FILTERS.find((value) => value === rawStatus);
  const cursor = rateCardCursorSchema.parse(rawAfter);
  const [createdAt, id] = cursor ? cursor.split("_") : [];
  const [cards, policies, options] = await Promise.all([
    listRateCards(organisationId, createdAt && id ? { createdAt, id } : undefined),
    listPricingPolicies(organisationId),
    canManage ? listRateScopeOptions(organisationId) : Promise.resolve(null),
  ]);
  const today = todayIsoDate();
  const in30 = addIsoDays(today, 30);
  const last = cards.at(-1);
  const summaries = cards.map((card) => summarise(card, today));

  const facilities = [
    ...new Set(cards.flatMap((card) => (card.facilityName ? [card.facilityName] : []))),
  ].sort();
  const disciplines = [
    ...new Map(cards.map((card) => [card.disciplineKey, card.disciplineName])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const rawFacility = first(raw.facility);
  const facilityFilter =
    rawFacility === ALL_FACILITIES ? ALL_FACILITIES : facilities.find((n) => n === rawFacility);
  const disciplineFilter = disciplines.find(([key]) => key === first(raw.discipline))?.[0];
  const rawShiftType = first(raw.type);
  const shiftTypeFilter =
    rawShiftType === ANY_SHIFT_TYPE
      ? ANY_SHIFT_TYPE
      : SHIFT_CLASSIFICATIONS.find((value) => value === rawShiftType);

  const shown = summaries.filter((summary) => {
    if (status && !matchesFilter(summary, status)) return false;
    if (facilityFilter) {
      const name = summary.card.facilityName ?? ALL_FACILITIES;
      if (name !== facilityFilter) return false;
    }
    if (disciplineFilter && summary.card.disciplineKey !== disciplineFilter) return false;
    if (shiftTypeFilter && (summary.card.classification ?? ANY_SHIFT_TYPE) !== shiftTypeFilter) {
      return false;
    }
    return true;
  });

  const countOf = (filter: CardFilter) =>
    summaries.filter((summary) => matchesFilter(summary, filter)).length;
  const activeDisciplines = new Set(
    summaries.filter((s) => s.state === "active").map((s) => s.card.disciplineKey),
  ).size;
  const endingSoon = summaries.filter(
    (s) =>
      s.state === "active" &&
      s.shown?.periodEnd !== null &&
      s.shown?.periodEnd !== undefined &&
      s.shown.periodEnd <= in30,
  ).length;
  const narrowed = Boolean(facilityFilter || disciplineFilter || shiftTypeFilter);
  const hasFilters = Boolean(status || narrowed);
  const base = `/app/organisations/${organisationId}/rates` as const;
  const quick = (filter: CardFilter) => ({
    href: `${base}?status=${filter}` as Route,
    active: status === filter && !narrowed,
  });
  const pricingHref = canSeePricing
    ? (`/app/organisations/${organisationId}/pricing?state=attention` as Route)
    : null;
  const policyRows = [
    ...policies.rounding.map((p) => ({ ...p, kind: "Rounding" })),
    ...policies.overtime.map((p) => ({ ...p, kind: `Overtime (${p.side ?? ""})` })),
  ];

  return (
    <div className="chelth-locked flex flex-col gap-[13px]">
      <PageHeader
        variant="reference"
        className="xl:mb-1"
        title="Rates"
        description={<p>Manage pay and bill rate structures used when pricing approved work.</p>}
        primaryAction={
          options ? (
            <HeaderAddAction href="#add-rate-card">Add Rate Card</HeaderAddAction>
          ) : undefined
        }
      />

      {manage === "step_up_required" ? (
        <StepUpNotice returnTo={base}>
          Changing rates requires verification with your authenticator app.
        </StepUpNotice>
      ) : null}

      {options ? (
        // The existing create flow, revealed by "Add Rate Card" (CSS :target, same action).
        <section
          id="add-rate-card"
          aria-labelledby="new-rate-heading"
          className={cn(REF_CARD_FROSTED, "hidden scroll-mt-24 flex-col gap-3 p-4 target:flex")}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2
                id="new-rate-heading"
                className="font-display text-[18px] leading-6 font-semibold text-chelth-navy"
              >
                Add a rate card
              </h2>
              <RecordNote>
                Saved as a draft. Nothing applies until you activate it from its start date.
              </RecordNote>
            </div>
            <a
              href="#rate-cards-heading"
              className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-primary underline underline-offset-4 hover:bg-surface-muted sm:min-h-9"
            >
              Close
            </a>
          </div>
          <NewRateForm
            organisationId={organisationId}
            disciplines={options.disciplines}
            relationships={options.relationships}
            today={today}
          />
        </section>
      ) : null}

      {/* Locked: with Rate Details open on wide screens the work area contracts beside it. */}
      <div className="flex flex-col gap-[13px] min-[1536px]:has-[dialog[open]]:pr-[407px]">
        <section
          aria-label="Rate cards by status"
          className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-[13px]"
        >
          <RefKpiCard
            label="Active Rate Cards"
            value={countOf("active")}
            supporting="Rate in force today"
            footer={
              <KpiNote tone="success">
                {activeDisciplines === 1 ? "1 discipline" : `${activeDisciplines} disciplines`}{" "}
                covered
              </KpiNote>
            }
            glyph="document"
            icon={<WorkspaceNavIcon name="rates" strokeWidth={2.25} duotone />}
            tone="teal"
            {...quick("active")}
          />
          <RefKpiCard
            label="Needs Attention"
            value={countOf("attention")}
            supporting="No rate in force today"
            footer={<KpiNote tone="danger">Blocks matching work</KpiNote>}
            glyph="alert"
            icon={<WorkspaceNavIcon name="requests" strokeWidth={2.25} duotone />}
            tone="danger"
            {...quick("attention")}
          />
          <RefKpiCard
            label="Draft Versions"
            value={countOf("draft")}
            supporting="Waiting to be activated"
            footer={<KpiNote tone="warning">Not used for pricing</KpiNote>}
            glyph="document"
            icon={<WorkspaceNavIcon name="timesheets" strokeWidth={2.25} duotone />}
            tone="warning"
            {...quick("draft")}
          />
          <RefKpiCard
            label="Upcoming Changes"
            value={countOf("upcoming")}
            supporting="Start on a later date"
            footer={<KpiNote tone="info">{endingSoon} ending within 30 days</KpiNote>}
            glyph="calendar"
            icon={<WorkspaceNavIcon name="shifts" strokeWidth={2.25} duotone />}
            tone="info"
            {...quick("upcoming")}
          />
        </section>

        {cards.length > 0 ? (
          // Locked filter row: each control narrows the loaded rate cards.
          <form
            key={JSON.stringify([status, facilityFilter, disciplineFilter, shiftTypeFilter])}
            aria-label="Filter rate cards"
            method="get"
            className="flex flex-wrap items-center gap-[9px]"
          >
            <LockedFilterSelect
              id="rate-facility"
              name="facility"
              label="Filter by facility"
              value={facilityFilter ?? ""}
              className="xl:w-[200px]"
              icon={<WorkspaceNavIcon name="facilities" strokeWidth={2.1} />}
            >
              <option value="">Every facility scope</option>
              <option value={ALL_FACILITIES}>All facilities (agency-wide)</option>
              {facilities.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </LockedFilterSelect>
            <LockedFilterSelect
              id="rate-discipline"
              name="discipline"
              label="Filter by discipline"
              value={disciplineFilter ?? ""}
              className="xl:w-[220px]"
              icon={<WorkspaceNavIcon name="workforce" strokeWidth={2.1} />}
            >
              <option value="">All disciplines</option>
              {disciplines.map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </LockedFilterSelect>
            <LockedFilterSelect
              id="rate-type"
              name="type"
              label="Filter by shift type"
              value={shiftTypeFilter ?? ""}
              className="xl:w-[176px]"
              icon={<WorkspaceNavIcon name="shifts" strokeWidth={2.1} />}
            >
              <option value="">All shift types</option>
              <option value={ANY_SHIFT_TYPE}>Any shift type</option>
              {SHIFT_CLASSIFICATIONS.map((value) => (
                <option key={value} value={value}>
                  {SHIFT_CLASSIFICATION_LABELS[value]}
                </option>
              ))}
            </LockedFilterSelect>
            <LockedFilterSelect
              id="rate-status"
              name="status"
              label="Filter by status"
              value={status ?? ""}
              className="xl:w-[250px]"
            >
              <option value="">All statuses</option>
              {CARD_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {CARD_FILTER_LABELS[value]}
                </option>
              ))}
            </LockedFilterSelect>
            <button
              type="submit"
              className="inline-flex h-11 items-center rounded-md border border-chelth-border bg-white/90 px-4 text-[13.5px] font-medium text-chelth-navy hover:bg-surface-muted sm:h-[46px]"
            >
              Show
            </button>
            {hasFilters ? (
              <Link
                href={base as Route}
                className="inline-flex min-h-11 items-center px-1 text-[13px] font-medium text-primary underline underline-offset-4"
              >
                Clear filters
              </Link>
            ) : null}
          </form>
        ) : null}

        <RefPanel
          title="Current Rate Cards"
          titleId="rate-cards-heading"
          className="scroll-mt-24"
          action={
            <span className="text-[13.5px] text-muted-foreground">
              {shown.length === 1 ? "1 rate card" : `${shown.length} rate cards`}
              {cards.length === 50 ? " · first 50" : ""}
            </span>
          }
        >
          {cards.length === 0 ? (
            <LockedEmpty
              icon="rates"
              title="No rate cards yet."
              note="Work cannot be priced until a rate card covers it."
            >
              {options ? (
                <a
                  href="#add-rate-card"
                  className="inline-flex min-h-11 items-center gap-2 rounded-[8px] border border-[rgba(0,90,96,0.35)] bg-white px-4 text-[14px] font-semibold text-chelth-navy shadow-[0_1px_2px_rgba(13,47,66,0.05)] hover:border-chelth-teal-dark hover:bg-[#f4fbf9]"
                >
                  Add Rate Card
                </a>
              ) : null}
            </LockedEmpty>
          ) : shown.length === 0 ? (
            <LockedEmpty
              icon="rates"
              title="No rate cards match these filters."
              note="Change the facility, discipline, shift type or status to see others."
            />
          ) : (
            <DataTableRegion
              aria-label="Rate cards table"
              className="mt-[9px] rounded-none border-0 bg-transparent"
            >
              <table className={cn(REF_TABLE, "min-w-[940px] table-fixed")}>
                <colgroup>
                  <col className="w-[19%]" />
                  <col className="w-[17%]" />
                  <col className="w-[11%]" />
                  <col className="w-[9%]" />
                  <col className="w-[9%]" />
                  <col className="w-[11%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[4%]" />
                </colgroup>
                <thead className={REF_TEXT.tableHead}>
                  <tr>
                    <th scope="col">Facility</th>
                    <th scope="col">Discipline</th>
                    <th scope="col">Shift Type</th>
                    <th scope="col">Pay Rate</th>
                    <th scope="col">Bill Rate</th>
                    <th scope="col">Effective From</th>
                    <th scope="col">Effective To</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody className={REF_TEXT.tableBody}>
                  {shown.map((summary) => {
                    const { card, scope, facility, shiftType, state, shown: version } = summary;
                    const drafts = summary.phases.filter((phase) => phase === "draft").length;
                    const flags = [
                      ...(state !== "draft" && drafts > 0
                        ? [drafts === 1 ? "1 draft" : `${drafts} drafts`]
                        : []),
                      ...(state === "active" && summary.phases.includes("upcoming")
                        ? ["Change upcoming"]
                        : []),
                    ];
                    return (
                      <tr
                        key={card.id}
                        className="h-[42px] transition-colors hover:bg-surface-muted/50 has-[dialog[open]]:bg-chelth-mint-mist/70 [&:has(dialog[open])>*:first-child]:shadow-[inset_3px_0_0_var(--chelth-teal)]"
                      >
                        <td>
                          <span className="flex min-w-0 items-center gap-2">
                            <LocationPin className="size-4 shrink-0 text-chelth-teal-dark" />
                            <span className="truncate font-medium text-chelth-navy">
                              {facility}
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className="line-clamp-2" title={card.disciplineName}>
                            {card.disciplineName}
                          </span>
                        </td>
                        <td className="truncate">{shiftType}</td>
                        <td className="whitespace-nowrap tabular-nums">
                          {version ? formatHourlyRate(version.payRateMinor, version.currency) : "—"}
                        </td>
                        <td className="whitespace-nowrap tabular-nums">
                          {version
                            ? formatHourlyRate(version.billRateMinor, version.currency)
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap">
                          {version ? rateDay(version.effectiveFrom) : "—"}
                        </td>
                        <td className="whitespace-nowrap">
                          {version ? rateDay(version.periodEnd ?? version.effectiveTo, "—") : "—"}
                        </td>
                        <td>
                          <span className="flex flex-col items-start gap-1 py-2">
                            <RefChip tone={CARD_STATE_TONE[state]} className="font-normal">
                              {CARD_STATE_LABELS[state]}
                            </RefChip>
                            {flags.length > 0 ? (
                              <span className="text-[11.5px] leading-4 text-slate-600">
                                {flags.join(" · ")}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="text-right">
                          <DetailDrawerTrigger
                            triggerLabel="⋯"
                            triggerClassName="justify-center px-2 text-lg font-bold text-chelth-navy no-underline sm:min-h-9"
                            triggerAccessibleLabel={`Rate details for ${scope}`}
                            title="Rate Details"
                            width="profile"
                          >
                            <RateDetailsPanel
                              summary={summary}
                              organisationId={organisationId}
                              today={today}
                              canManage={canManage}
                              pricingHref={pricingHref}
                            />
                          </DetailDrawerTrigger>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DataTableRegion>
          )}
          {cards.length === 50 && last ? (
            <Link
              href={`${base}?after=${encodeURIComponent(`${last.createdAt}_${last.id}`)}` as Route}
              className="mt-2 inline-flex min-h-11 w-fit items-center px-[5px] text-[13px] font-medium text-primary underline underline-offset-4"
            >
              Next rate cards
            </Link>
          ) : null}
        </RefPanel>

        <RefPanel title="Rounding and Overtime" titleId="policies-heading">
          <RecordNote className="max-w-3xl px-[5px] pt-1 pb-2">
            Both are off unless you activate a policy. Rounding applies per timesheet entry and
            never changes recorded time. Overtime is a weekly threshold per timesheet week, set
            separately for pay and bill. These are calculations you configure, not legal advice.
          </RecordNote>
          {policyRows.length === 0 ? (
            <LockedEmpty
              icon="pricing"
              title="No rounding, no overtime."
              note="Worked minutes are priced as recorded at the base hourly rate."
            />
          ) : (
            <DataTableRegion
              aria-label="Pricing policies"
              className="rounded-none border-0 bg-transparent"
            >
              <table className={cn(REF_TABLE, "min-w-[640px]")}>
                <thead className={REF_TEXT.tableHead}>
                  <tr>
                    <th scope="col">Policy</th>
                    <th scope="col">Rule</th>
                    <th scope="col">From</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className={REF_TEXT.tableBody}>
                  {policyRows.map((policy) => (
                    <tr key={policy.id} className="h-[42px]">
                      <td className="font-medium text-chelth-navy">
                        {policy.kind} v{policy.version}
                      </td>
                      <td>
                        {policy.roundingMode
                          ? describeRounding(policy.roundingMode, policy.increment ?? null)
                          : describeOvertime(
                              policy.numerator ?? null,
                              policy.denominator ?? null,
                              policy.thresholdMinutes,
                            )}
                      </td>
                      <td className="whitespace-nowrap">{rateDay(policy.effectiveFrom)}</td>
                      <td>
                        <RefChip
                          tone={
                            policy.status === "active"
                              ? "success"
                              : policy.status === "draft"
                                ? "warning"
                                : "neutral"
                          }
                          className="font-normal"
                        >
                          {policy.status === "active"
                            ? "Active"
                            : policy.status === "draft"
                              ? "Draft"
                              : "Discarded"}
                        </RefChip>
                      </td>
                      <td>
                        {canManage && policy.status === "draft" ? (
                          <span className="flex gap-2 py-1.5">
                            <InlineActionForm
                              action={setPolicyStatusAction}
                              fields={{ organisationId, policyId: policy.id, status: "active" }}
                              label="Activate"
                              accessibleLabel={`Activate ${policy.kind} v${policy.version}`}
                              variant="primary"
                            />
                            <InlineActionForm
                              action={setPolicyStatusAction}
                              fields={{ organisationId, policyId: policy.id, status: "discarded" }}
                              label="Discard"
                              accessibleLabel={`Discard ${policy.kind} v${policy.version}`}
                              variant="ghost"
                            />
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTableRegion>
          )}
          {canManage ? (
            <div className="flex flex-col gap-4 px-[5px] pt-3">
              <RoundingPolicyForm organisationId={organisationId} today={today} />
              <OvertimePolicyForm organisationId={organisationId} today={today} />
            </div>
          ) : null}
        </RefPanel>
      </div>
    </div>
  );
}
