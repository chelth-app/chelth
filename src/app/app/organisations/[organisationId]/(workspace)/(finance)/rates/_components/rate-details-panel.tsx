import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { DetailsTabs } from "@/components/reference/details-tabs";
import { REF_TABLE, REF_TEXT, RefChip } from "@/components/reference/locked-reference";
import { DataTableRegion } from "@/components/ui/data-table";
import { KeyValueList } from "@/components/ui/key-value-list";
import { LocationPin } from "@/components/ui/location-pin";
import { activateVersionAction, discardVersionAction, NewVersionForm } from "@/features/pricing";
import {
  formatHourlyRate,
  RATE_PRECEDENCE_LABELS,
  VERSION_PHASE_LABELS,
  versionPhase,
} from "@/lib/domain/pricing";
import { cn } from "@/lib/utils/cn";

import { INK } from "../../_components/finance-locked";
import {
  CARD_STATE_LABELS,
  CARD_STATE_TONE,
  PHASE_TONE,
  type RateCardSummary,
  rateDay,
} from "./rate-card-summary";

/*
 * Rate Details — the canonical Chelth drawer (CHELTH-LOCKED-VISUAL-SYSTEM.md,
 * C) with rate-card content. Versions are never edited once active: changes
 * are a new draft version that is activated from its start date. The
 * activate / discard / new-version controls are the existing forms; the
 * database re-checks rates.manage (and step-up) on every one.
 */

function Section({
  id,
  title,
  children,
  divided = true,
}: {
  id: string;
  title: string;
  children: ReactNode;
  divided?: boolean;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "flex flex-col gap-2.5 py-3.5",
        divided && "border-t border-[rgba(18,107,103,0.12)]",
      )}
    >
      <h3 id={id} className={cn("text-[16px] leading-[22px] font-semibold", INK)}>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Reference status note (as Timesheet Details "Attendance Verification"). */
function RuleNote({
  tone,
  title,
  note,
}: {
  tone: "success" | "warning";
  title: string;
  note: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[10px] border px-3.5 py-3",
        tone === "success"
          ? "border-[rgba(18,107,103,0.07)] bg-[#f8fcfb]"
          : "border-[rgba(180,120,20,0.10)] bg-warning-soft/40",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-white",
          tone === "success" ? "bg-success-indicator" : "bg-warning-indicator",
        )}
      >
        <svg
          viewBox="0 0 16 16"
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
        >
          {tone === "success" ? (
            <path d="m4 8.5 2.5 2.5L12 5.5" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M8 4.5v4.5M8 11.5v.01" strokeLinecap="round" />
          )}
        </svg>
      </span>
      <span className="flex flex-col">
        <span className="text-[14px] leading-5 font-medium text-chelth-navy">{title}</span>
        <span className="text-[12.5px] leading-[18px] text-slate-600">{note}</span>
      </span>
    </div>
  );
}

export function RateDetailsPanel({
  summary,
  organisationId,
  today,
  canManage,
  pricingHref,
}: {
  summary: RateCardSummary;
  organisationId: string;
  today: string;
  canManage: boolean;
  /** The pricing queue (pricing.view holders only). */
  pricingHref: Route | null;
}) {
  const { card, scope, facility, shiftType, state, shown, tier } = summary;
  const id = `rate-${card.id}`;
  const versions = [...card.versions].sort((a, b) => b.version - a.version);

  const details = (
    <div className="flex flex-col">
      <Section id={`${id}-details`} title="Rate Details" divided={false}>
        <KeyValueList
          className="sm:grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] sm:gap-x-5"
          items={[
            {
              label: "Worker pay rate",
              value: shown ? (
                <span className="tabular-nums">
                  {formatHourlyRate(shown.payRateMinor, shown.currency)}
                </span>
              ) : (
                "—"
              ),
            },
            {
              label: "Bill rate",
              value: shown ? (
                <span className="tabular-nums">
                  {formatHourlyRate(shown.billRateMinor, shown.currency)}
                </span>
              ) : (
                "—"
              ),
            },
            { label: "Currency", value: shown?.currency ?? "—" },
            {
              label: "Version",
              value: shown
                ? `v${shown.version} · ${VERSION_PHASE_LABELS[versionPhase(shown, today)]}`
                : "—",
            },
            { label: "Effective from", value: shown ? rateDay(shown.effectiveFrom) : "—" },
            {
              label: "Effective to",
              value: shown ? rateDay(shown.periodEnd ?? shown.effectiveTo) : "—",
            },
            { label: "Matching level", value: `${tier} · ${RATE_PRECEDENCE_LABELS[tier]}` },
          ]}
        />
      </Section>
      <Section id={`${id}-rule`} title="Pricing Rule">
        {state === "active" ? (
          <RuleNote
            tone="success"
            title="Prices matching work"
            note="Work at this level is priced with the version in force on each work date. Priced timesheets keep the rates they were priced with."
          />
        ) : (
          <RuleNote
            tone="warning"
            title="No rate in force today"
            note="Matching work cannot be priced until a version is in force on its work date. Chelth does not fall back to a broader rate card."
          />
        )}
      </Section>
    </div>
  );

  const versionList = (
    <Section id={`${id}-versions`} title="Versions" divided={false}>
      <DataTableRegion
        aria-label={`Versions: ${scope}`}
        className="rounded-none border-0 bg-transparent"
      >
        <table className={cn(REF_TABLE, "min-w-[340px]")}>
          <thead className={REF_TEXT.tableHead}>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">Applies</th>
              <th scope="col">Pay / Bill</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className={REF_TEXT.tableBody}>
            {versions.map((version) => {
              const phase = versionPhase(version, today);
              return (
                <tr key={version.id}>
                  <td>
                    <span className="flex flex-col items-start gap-1 py-1.5">
                      <span className="font-medium text-chelth-navy tabular-nums">
                        v{version.version}
                      </span>
                      <RefChip tone={PHASE_TONE[phase]} className="font-normal">
                        {VERSION_PHASE_LABELS[phase]}
                      </RefChip>
                    </span>
                  </td>
                  <td>
                    {rateDay(version.effectiveFrom)} –<br />
                    {rateDay(version.periodEnd ?? version.effectiveTo)}
                  </td>
                  <td className="tabular-nums">
                    {formatHourlyRate(version.payRateMinor, version.currency)}
                    <br />
                    {formatHourlyRate(version.billRateMinor, version.currency)}
                  </td>
                  <td>
                    {canManage && version.status === "draft" ? (
                      <span className="flex flex-col items-start gap-1.5 py-1.5">
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
      </DataTableRegion>
      {canManage ? (
        <NewVersionForm
          organisationId={organisationId}
          rateCardId={card.id}
          label={scope}
          today={today}
          stacked
        />
      ) : (
        <p className="text-[12.5px] leading-[18px] text-slate-600">
          A change is a new version from its start date; history is never rewritten.
        </p>
      )}
    </Section>
  );

  return (
    <div className="flex min-h-full flex-col text-[13.5px] leading-5">
      {/* Identity: rate tile, facility scope, discipline, shift type, status. */}
      <div className="flex items-start gap-4 pt-1">
        <span
          aria-hidden="true"
          className="inline-flex size-[84px] shrink-0 items-center justify-center rounded-[14px] bg-[radial-gradient(circle_at_30%_25%,#f4fdfa_0%,#d3f2e8_45%,#a9e3d3_100%)] text-chelth-teal-dark shadow-[0_6px_16px_rgba(0,90,96,0.18),inset_0_1px_0_rgba(255,255,255,0.9)] ring-4 ring-white [&>svg]:size-10"
        >
          <WorkspaceNavIcon name="rates" strokeWidth={1.9} duotone />
        </span>
        <div className="flex min-w-0 flex-1 flex-col pt-1">
          <p
            className={cn(
              "font-display text-[21px] leading-[27px] font-bold tracking-[-0.02em]",
              INK,
            )}
          >
            {card.disciplineName}
          </p>
          <p className="truncate text-[14.5px] leading-[22px] font-medium text-slate-600">
            {shiftType}
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[13.5px] text-slate-600">
              <LocationPin className="size-4 text-chelth-teal-dark" />
              <span className="truncate">{facility}</span>
            </span>
            <RefChip tone={CARD_STATE_TONE[state]} className="h-7 px-3 text-[12.5px] font-semibold">
              {CARD_STATE_LABELS[state]}
            </RefChip>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <DetailsTabs
          label={`${scope} rate card`}
          tabs={[
            { id: "overview", label: "Overview", content: details },
            { id: "versions", label: "Versions", content: versionList },
          ]}
        />
      </div>

      {pricingHref ? (
        <div className="mt-auto flex flex-col gap-2.5 pt-4">
          <Link
            href={pricingHref}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-[rgba(0,90,96,0.35)] bg-white text-[14px] font-semibold text-chelth-navy shadow-[0_1px_2px_rgba(13,47,66,0.05)] hover:border-chelth-teal-dark hover:bg-[#f4fbf9]"
          >
            <WorkspaceNavIcon
              name="pricing"
              strokeWidth={2.1}
              className="size-[18px] text-chelth-teal-dark"
            />
            View Pricing Queue
          </Link>
        </div>
      ) : null}
    </div>
  );
}
