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

  const query = await searchParams;
  const raw = query.view;
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
  // P0-E9-4A.1: several agencies ⇒ an agency filter over the same authorised rows.
  const agencies = [...new Set(shown.map((row) => row.agencyName))].sort();
  const agency = agencies.find((name) => name === query.agency) ?? null;
  const filtered = agency ? shown.filter((row) => row.agencyName === agency) : shown;
  const withAgency = (href: string, name: string | null) =>
    (name ? `${href}${href.includes("?") ? "&" : "?"}agency=${encodeURIComponent(name)}` : href) as Route;

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
          href: withAgency(key === "today" ? base : `${base}?view=${key}`, agency),
          current: key === view,
        }))}
      />
      {agencies.length > 1 ? (
        <SectionTabs
          label="Filter by agency"
          tabs={[null, ...agencies].map((name) => ({
            label: name ?? "All agencies",
            href: withAgency(view === "today" ? base : `${base}?view=${view}`, name),
            current: name === agency,
          }))}
        />
      ) : null}
      <RefPanel title={VIEWS[view].label} titleId="coverage-heading">
        {filtered.length === 0 ? (
          <LockedEmpty icon="workforce" title={empty.title} note={empty.note} />
        ) : (
          <FacilityCoverageTable
            organisationId={organisationId}
            rows={filtered}
            label={`Coverage: ${VIEWS[view].label}`}
            showReadiness={view !== "recent"}
          />
        )}
      </RefPanel>
    </div>
  );
}
