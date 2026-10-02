import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Panel } from "@/components/ui/panel";

import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { InlineActionForm } from "@/components/forms/inline-action-form";
import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterSelect } from "@/components/ui/filter-bar";
import { KpiFilterCard, KpiFilterGroup } from "@/components/ui/kpi-filter-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import {
  activateVersionAction,
  discardVersionAction,
  listPricingPolicies,
  listRateCards,
  listRateScopeOptions,
  NewRateForm,
  NewVersionForm,
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
  type VersionPhase,
  VERSION_PHASE_LABELS,
  versionPhase,
} from "@/lib/domain/pricing";
import { todayIsoDate } from "@/lib/domain/shifts";

import { FinanceModeTabs } from "../_components/finance-mode-tabs";

export const metadata: Metadata = { title: "Rates" };

const PHASE_TONE: Record<VersionPhase, StatusTone> = {
  draft: "warning",
  discarded: "neutral",
  upcoming: "info",
  current: "success",
  superseded: "neutral",
  ended: "neutral",
};

const dateFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium" });
function day(value: string | null): string {
  return value ? dateFormat.format(new Date(`${value}T00:00:00Z`)) : "No end";
}

/**
 * Agency pricing configuration. Versions are never edited once active: a new
 * version supersedes the current one from its start date. Money is shown with
 * the version's own currency.
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

  const raw = await searchParams;
  const rawAfter = raw.after;
  const rawShow = Array.isArray(raw.show) ? raw.show[0] : raw.show;
  const show = rawShow === "draft" || rawShow === "upcoming" ? rawShow : undefined;
  const cursor = rateCardCursorSchema.parse(Array.isArray(rawAfter) ? rawAfter[0] : rawAfter);
  const [createdAt, id] = cursor ? cursor.split("_") : [];
  const [cards, policies, options] = await Promise.all([
    listRateCards(organisationId, createdAt && id ? { createdAt, id } : undefined),
    listPricingPolicies(organisationId),
    canManage ? listRateScopeOptions(organisationId) : Promise.resolve(null),
  ]);
  const today = todayIsoDate();
  const last = cards.at(-1);
  const phasesOf = (card: (typeof cards)[number]) =>
    card.versions.map((version) => versionPhase(version, today));
  const withPhase = (phase: VersionPhase) =>
    cards.filter((card) => phasesOf(card).includes(phase)).length;
  // Display filter over the rate cards already loaded (no new query).
  const shownCards = show ? cards.filter((card) => phasesOf(card).includes(show)) : cards;
  const base = `/app/organisations/${organisationId}/rates` as const;

  return (
    <>
      <PageHeader
        title="Rates"
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
            Hourly pay and bill rates by facility, discipline and shift type. Pay and bill are set
            separately. A new version never changes history: it applies from its start date, and
            priced timesheets keep the rates they were priced with.
          </p>
        }
        primaryAction={
          options ? (
            <a
              href="#new-rate-heading"
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              Add a rate
            </a>
          ) : undefined
        }
      />

      <FinanceModeTabs organisationId={organisationId} current="rates" can={can} />

      <KpiFilterGroup label="Rate cards summary">
        <KpiFilterCard
          label="Rate cards"
          value={cards.length}
          supporting={cards.length === 50 ? "First 50 shown" : "Facility · discipline · shift type"}
          icon={<WorkspaceNavIcon name="rates" />}
        />
        <KpiFilterCard
          label="With a current version"
          value={withPhase("current")}
          supporting="Can price work today"
          icon={<WorkspaceNavIcon name="pricing" />}
        />
        <KpiFilterCard
          label="With a draft version"
          value={withPhase("draft")}
          supporting="Waiting to be activated"
          icon={<WorkspaceNavIcon name="timesheets" />}
          href={`${base}?show=draft` as Route}
          active={show === "draft"}
        />
        <KpiFilterCard
          label="With an upcoming version"
          value={withPhase("upcoming")}
          supporting="Starts on a later date"
          icon={<WorkspaceNavIcon name="shifts" />}
          href={`${base}?show=upcoming` as Route}
          active={show === "upcoming"}
        />
      </KpiFilterGroup>

      {manage === "step_up_required" ? (
        <StepUpNotice returnTo={`/app/organisations/${organisationId}/rates`}>
          Changing rates requires verification with your authenticator app.
        </StepUpNotice>
      ) : null}

      {options ? (
        <Panel titleId="new-rate-heading" title={<>Add a rate</>}>
          <NewRateForm
            organisationId={organisationId}
            disciplines={options.disciplines}
            relationships={options.relationships}
            today={today}
          />
        </Panel>
      ) : null}

      <Panel titleId="rate-cards-heading" title={<>Rate cards</>}>
        {cards.length > 0 ? (
          <FilterBar
            key={show ?? "all"}
            label="Filter rate cards"
            resetHref={show ? (base as Route) : undefined}
          >
            <FilterSelect
              label="Show rate cards"
              id="rate-show"
              name="show"
              defaultValue={show ?? ""}
            >
              <option value="">All rate cards</option>
              <option value="draft">With a draft version</option>
              <option value="upcoming">With an upcoming version</option>
            </FilterSelect>
          </FilterBar>
        ) : null}
        {cards.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No rates yet."
            description="Work cannot be priced until a rate covers it."
          />
        ) : (
          <ul aria-label="Rate cards" className="flex flex-col divide-y divide-border">
            {shownCards.map((card) => {
              const scope = `${card.facilityName ?? "All facilities"} · ${card.disciplineName} · ${
                card.classification
                  ? SHIFT_CLASSIFICATION_LABELS[card.classification]
                  : "Any shift type"
              }`;
              return (
                <li
                  key={card.id}
                  aria-label={scope}
                  className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0"
                >
                  <h3 className="text-sm font-semibold">{scope}</h3>
                  <DataTableRegion aria-label={`Versions: ${scope}`}>
                    <DataTable className="min-w-[760px]">
                      <DataTableHead>
                        <tr>
                          <DataTableHeaderCell>Version</DataTableHeaderCell>
                          <DataTableHeaderCell>Status</DataTableHeaderCell>
                          <DataTableHeaderCell>Applies</DataTableHeaderCell>
                          <DataTableHeaderCell numeric>Pay</DataTableHeaderCell>
                          <DataTableHeaderCell numeric>Bill</DataTableHeaderCell>
                          <DataTableHeaderCell>Currency</DataTableHeaderCell>
                          <DataTableHeaderCell>
                            <span className="sr-only">Actions</span>
                          </DataTableHeaderCell>
                        </tr>
                      </DataTableHead>
                      <tbody>
                        {card.versions.map((version) => {
                          const phase = versionPhase(version, today);
                          return (
                            <DataTableRow key={version.id}>
                              <DataTableCell className="tabular-nums">
                                v{version.version}
                              </DataTableCell>
                              <DataTableCell>
                                <StatusChip tone={PHASE_TONE[phase]}>
                                  {VERSION_PHASE_LABELS[phase]}
                                </StatusChip>
                              </DataTableCell>
                              <DataTableCell>
                                {day(version.effectiveFrom)} –{" "}
                                {day(version.periodEnd ?? version.effectiveTo)}
                              </DataTableCell>
                              <DataTableCell numeric>
                                {formatHourlyRate(version.payRateMinor, version.currency)}
                              </DataTableCell>
                              <DataTableCell numeric>
                                {formatHourlyRate(version.billRateMinor, version.currency)}
                              </DataTableCell>
                              <DataTableCell>{version.currency}</DataTableCell>
                              <DataTableCell>
                                {canManage && version.status === "draft" ? (
                                  <span className="flex gap-2">
                                    <InlineActionForm
                                      action={activateVersionAction}
                                      fields={{ organisationId, versionId: version.id }}
                                      label="Activate"
                                      accessibleLabel={`Activate v${version.version}: ${scope}`}
                                      variant="primary"
                                    />
                                    <InlineActionForm
                                      action={discardVersionAction}
                                      fields={{ organisationId, versionId: version.id }}
                                      label="Discard"
                                      accessibleLabel={`Discard v${version.version}: ${scope}`}
                                      variant="ghost"
                                    />
                                  </span>
                                ) : null}
                              </DataTableCell>
                            </DataTableRow>
                          );
                        })}
                      </tbody>
                    </DataTable>
                  </DataTableRegion>
                  {canManage ? (
                    <NewVersionForm
                      organisationId={organisationId}
                      rateCardId={card.id}
                      label={scope}
                      today={today}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {cards.length === 50 && last ? (
          <Link
            href={`/app/organisations/${organisationId}/rates?after=${encodeURIComponent(`${last.createdAt}_${last.id}`)}`}
            className="w-fit text-sm text-primary underline underline-offset-4"
          >
            Next rate cards
          </Link>
        ) : null}
      </Panel>

      <Panel titleId="policies-heading" title={<>Rounding and overtime</>}>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Both are off unless you activate a policy. Rounding applies per timesheet entry and never
          changes recorded time. Overtime is a weekly threshold per timesheet week, set separately
          for pay and bill. These settings are calculations you configure, not legal advice: you
          remain responsible for the law and contracts that apply.
        </p>
        <DataTableRegion aria-label="Pricing policies">
          <DataTable className="min-w-[640px]">
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>Policy</DataTableHeaderCell>
                <DataTableHeaderCell>Rule</DataTableHeaderCell>
                <DataTableHeaderCell>From</DataTableHeaderCell>
                <DataTableHeaderCell>Status</DataTableHeaderCell>
                <DataTableHeaderCell>
                  <span className="sr-only">Actions</span>
                </DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {[
                ...policies.rounding.map((p) => ({ ...p, kind: "Rounding" })),
                ...policies.overtime.map((p) => ({ ...p, kind: `Overtime (${p.side ?? ""})` })),
              ].map((policy) => (
                <DataTableRow key={policy.id}>
                  <DataTableCell>
                    {policy.kind} v{policy.version}
                  </DataTableCell>
                  <DataTableCell>
                    {policy.roundingMode
                      ? describeRounding(policy.roundingMode, policy.increment ?? null)
                      : describeOvertime(
                          policy.numerator ?? null,
                          policy.denominator ?? null,
                          policy.thresholdMinutes,
                        )}
                  </DataTableCell>
                  <DataTableCell>{day(policy.effectiveFrom)}</DataTableCell>
                  <DataTableCell>
                    <StatusChip
                      tone={
                        policy.status === "active"
                          ? "success"
                          : policy.status === "draft"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {policy.status === "active"
                        ? "Active"
                        : policy.status === "draft"
                          ? "Draft"
                          : "Discarded"}
                    </StatusChip>
                  </DataTableCell>
                  <DataTableCell>
                    {canManage && policy.status === "draft" ? (
                      <span className="flex gap-2">
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
                  </DataTableCell>
                </DataTableRow>
              ))}
              {policies.rounding.length + policies.overtime.length === 0 ? (
                <tr>
                  <DataTableCell colSpan={5} className="text-muted-foreground">
                    No rounding, no overtime.
                  </DataTableCell>
                </tr>
              ) : null}
            </tbody>
          </DataTable>
        </DataTableRegion>
        {canManage ? (
          <div className="flex flex-col gap-4">
            <RoundingPolicyForm organisationId={organisationId} today={today} />
            <OvertimePolicyForm organisationId={organisationId} today={today} />
          </div>
        ) : null}
      </Panel>
    </>
  );
}
