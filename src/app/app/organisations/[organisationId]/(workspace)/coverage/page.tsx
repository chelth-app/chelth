import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RefPanel } from "@/components/reference/locked-reference";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTabs } from "@/components/ui/section-tabs";
import { loadOrganisationPage, requireCapabilityOrNotFound } from "@/features/organisations";
import { listFacilityCoverage } from "@/features/shifts";
import { CAPABILITIES } from "@/lib/authz";
import { localDate } from "@/lib/domain/shifts";

import { LockedEmpty } from "../(finance)/_components/finance-locked";
import { FacilityCoverageTable } from "../_components/facility-coverage-table";

export const metadata: Metadata = { title: "Coverage" };

const VIEWS = {
  today: { label: "Today", from: -1, to: 1 },
  upcoming: { label: "Next 14 days", from: -1, to: 14 },
  recent: { label: "Last 7 days", from: -8, to: 0 },
} as const;
type View = keyof typeof VIEWS;

/** A UTC calendar date `days` from today (the window is widened by a day for timezones). */
function isoDay(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Facility Coverage (P0-E9-3K): the workers serving this facility — not an
 * agency workforce directory. Only people assigned to this facility's own
 * shifts, through its agency relationships, from one audited facility
 * projection (list_facility_coverage). No pay, contact details, other
 * facilities or agency notes.
 */
export default async function FacilityCoveragePage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/coverage">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.SHIFT_VIEW);
  const { organisationId, organisation } = context;
  if (organisation.type !== "facility") notFound();

  const raw = (await searchParams).view;
  const view: View = raw === "upcoming" || raw === "recent" ? raw : "today";
  const window = VIEWS[view];
  const rows = await listFacilityCoverage(organisationId, isoDay(window.from), isoDay(window.to));
  const now = new Date();
  const nowIso = now.toISOString();
  const shown = rows.filter((row) => {
    if (view === "today") return localDate(row.startAt, row.timezone) === localDate(nowIso, row.timezone);
    if (view === "upcoming") return new Date(row.endAt) > now;
    return new Date(row.endAt) <= now;
  });
  if (view === "recent") shown.reverse();

  const base = `/app/organisations/${organisationId}/coverage`;
  const empty = {
    today: {
      title: "No workers scheduled today.",
      note: "Workers your agencies assign to today's shifts appear here.",
    },
    upcoming: {
      title: "No workers assigned to upcoming shifts.",
      note: "Workers assigned to this facility will appear here. Request coverage when you need additional staff.",
    },
    recent: {
      title: "No shifts worked in the last 7 days.",
      note: "Workers who served your recent shifts appear here.",
    },
  }[view];

  return (
    <div className="chelth-locked flex flex-col gap-[13px]">
      <PageHeader
        variant="reference"
        className="xl:mb-1"
        title="Coverage"
        back={
          <Link
            href={`/app/organisations/${organisationId}`}
            className="text-primary underline underline-offset-4"
          >
            {organisation.name}
          </Link>
        }
        description={
          <p>The workers your agencies have assigned to your shifts, and how each is responding.</p>
        }
      />
      <SectionTabs
        label="Coverage period"
        tabs={(Object.keys(VIEWS) as View[]).map((key) => ({
          label: VIEWS[key].label,
          href: (key === "today" ? base : `${base}?view=${key}`) as Route,
          current: key === view,
        }))}
      />
      <RefPanel title={VIEWS[view].label} titleId="coverage-heading">
        {shown.length === 0 ? (
          <LockedEmpty icon="workforce" title={empty.title} note={empty.note} />
        ) : (
          <FacilityCoverageTable
            organisationId={organisationId}
            rows={shown}
            label={`Coverage: ${VIEWS[view].label}`}
            showReadiness={view !== "recent"}
          />
        )}
      </RefPanel>
    </div>
  );
}
