import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { Badge, type BadgeProps } from "@/components/ui/badge";
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

export const metadata: Metadata = { title: "Rates" };

const PHASE_TONE: Record<VersionPhase, NonNullable<BadgeProps["tone"]>> = {
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

  const rawAfter = (await searchParams).after;
  const cursor = rateCardCursorSchema.parse(Array.isArray(rawAfter) ? rawAfter[0] : rawAfter);
  const [createdAt, id] = cursor ? cursor.split("_") : [];
  const [cards, policies, options] = await Promise.all([
    listRateCards(organisationId, createdAt && id ? { createdAt, id } : undefined),
    listPricingPolicies(organisationId),
    canManage ? listRateScopeOptions(organisationId) : Promise.resolve(null),
  ]);
  const today = todayIsoDate();
  const last = cards.at(-1);

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          {organisation.name}
        </Link>
        <h1 className="text-2xl font-semibold">Rates</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Hourly pay and bill rates by facility, discipline and shift type. Pay and bill are set
          separately. A new version never changes history: it applies from its start date, and
          priced timesheets keep the rates they were priced with.
        </p>
      </header>

      {manage === "step_up_required" ? (
        <StepUpNotice returnTo={`/app/organisations/${organisationId}/rates`}>
          Changing rates requires verification with your authenticator app.
        </StepUpNotice>
      ) : null}

      {options ? (
        <section aria-labelledby="new-rate-heading" className="flex flex-col gap-3">
          <h2 id="new-rate-heading" className="text-lg font-semibold">
            Add a rate
          </h2>
          <NewRateForm
            organisationId={organisationId}
            disciplines={options.disciplines}
            relationships={options.relationships}
            today={today}
          />
        </section>
      ) : null}

      <section aria-labelledby="rate-cards-heading" className="flex flex-col gap-3">
        <h2 id="rate-cards-heading" className="text-lg font-semibold">
          Rate cards
        </h2>
        {cards.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No rates yet. Work cannot be priced until a rate covers it.
          </p>
        ) : (
          <ul aria-label="Rate cards" className="flex flex-col gap-4">
            {cards.map((card) => {
              const scope = `${card.facilityName ?? "All facilities"} · ${card.disciplineName} · ${
                card.classification
                  ? SHIFT_CLASSIFICATION_LABELS[card.classification]
                  : "Any shift type"
              }`;
              return (
                <li key={card.id} aria-label={scope} className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">{scope}</h3>
                  <div
                    role="region"
                    aria-label={`Versions: ${scope}`}
                    tabIndex={0}
                    className="overflow-x-auto rounded-lg border border-border bg-surface"
                  >
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                        <tr>
                          <th scope="col" className="px-3 py-2 font-medium">
                            Version
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            Status
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            Applies
                          </th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">
                            Pay
                          </th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">
                            Bill
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            Currency
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {card.versions.map((version) => {
                          const phase = versionPhase(version, today);
                          return (
                            <tr key={version.id} className="border-b border-border last:border-0">
                              <td className="px-3 py-2 tabular-nums">v{version.version}</td>
                              <td className="px-3 py-2">
                                <Badge tone={PHASE_TONE[phase]}>
                                  {VERSION_PHASE_LABELS[phase]}
                                </Badge>
                              </td>
                              <td className="px-3 py-2">
                                {day(version.effectiveFrom)} –{" "}
                                {day(version.periodEnd ?? version.effectiveTo)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatHourlyRate(version.payRateMinor, version.currency)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatHourlyRate(version.billRateMinor, version.currency)}
                              </td>
                              <td className="px-3 py-2">{version.currency}</td>
                              <td className="px-3 py-2">
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
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
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
      </section>

      <section aria-labelledby="policies-heading" className="flex flex-col gap-3">
        <h2 id="policies-heading" className="text-lg font-semibold">
          Rounding and overtime
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Both are off unless you activate a policy. Rounding applies per timesheet entry and never
          changes recorded time. Overtime is a weekly threshold per timesheet week, set separately
          for pay and bill. These settings are calculations you configure, not legal advice: you
          remain responsible for the law and contracts that apply.
        </p>
        <div
          role="region"
          aria-label="Pricing policies"
          tabIndex={0}
          className="overflow-x-auto rounded-lg border border-border bg-surface"
        >
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Policy
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Rule
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  From
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ...policies.rounding.map((p) => ({ ...p, kind: "Rounding" })),
                ...policies.overtime.map((p) => ({ ...p, kind: `Overtime (${p.side ?? ""})` })),
              ].map((policy) => (
                <tr key={policy.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    {policy.kind} v{policy.version}
                  </td>
                  <td className="px-3 py-2">
                    {policy.roundingMode
                      ? describeRounding(policy.roundingMode, policy.increment ?? null)
                      : describeOvertime(
                          policy.numerator ?? null,
                          policy.denominator ?? null,
                          policy.thresholdMinutes,
                        )}
                  </td>
                  <td className="px-3 py-2">{day(policy.effectiveFrom)}</td>
                  <td className="px-3 py-2">
                    <Badge
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
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
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
                  </td>
                </tr>
              ))}
              {policies.rounding.length + policies.overtime.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-2 text-muted-foreground">
                    No rounding, no overtime.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {canManage ? (
          <div className="flex flex-col gap-4">
            <RoundingPolicyForm organisationId={organisationId} today={today} />
            <OvertimePolicyForm organisationId={organisationId} today={today} />
          </div>
        ) : null}
      </section>
    </>
  );
}
