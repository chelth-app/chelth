import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { KeyValueList } from "@/components/ui/key-value-list";
import { FilterBar, FilterSelect } from "@/components/ui/filter-bar";
import { KpiFilterCard, KpiFilterGroup } from "@/components/ui/kpi-filter-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import {
  loadOrganisationPage,
  type OrganisationPageContext,
  StepUpNotice,
} from "@/features/organisations";
import {
  FacilityDecisionForms,
  FacilityStateBadge,
  listFacilityTimesheetEntries,
  listMyTimesheets,
  TimesheetStatusBadge,
} from "@/features/timesheets";
import { getMyWorkerRecord } from "@/features/workforce";
import { CAPABILITIES } from "@/lib/authz";
import { formatLocalClockTime } from "@/lib/domain/attendance";
import { formatShiftDate, formatShiftTimeRange } from "@/lib/domain/shifts";
import {
  blockingReasonLabel,
  DISPUTE_REASON_LABELS,
  formatPeriod,
  FACILITY_STATE_LABELS,
  formatWorkedMinutes,
  type TimesheetFacilityState,
} from "@/lib/domain/timesheets";

import { AgencyTimesheets } from "./_components/agency-timesheets";

export const metadata: Metadata = { title: "Timesheets" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

function Header({ context, intro }: { context: OrganisationPageContext; intro: string }) {
  return (
    <PageHeader
      title="Timesheets"
      back={
        <Link
          href={`/app/organisations/${context.organisationId}`}
          className="text-primary underline underline-offset-4"
        >
          {context.organisation.name}
        </Link>
      }
      description={<p>{intro}</p>}
    />
  );
}

/**
 * One route, three audiences: agency reviewers (timesheet.view), a worker
 * (their own weeks) and a linked facility (entries at its facility awaiting
 * sign-off). Each reads only its own projection.
 */
export default async function TimesheetsPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/timesheets">) {
  const context = await loadOrganisationPage((await params).organisationId);
  const { organisationId, organisation, can } = context;

  if (organisation.type === "facility") {
    const access = can(CAPABILITIES.TIMESHEET_FACILITY_SIGNOFF);
    if (access === "not_held") notFound();
    return <FacilityTimesheets context={context} rawState={first((await searchParams).state)} />;
  }

  if (can(CAPABILITIES.TIMESHEET_VIEW) !== "not_held") {
    return <AgencyTimesheets context={context} raw={await searchParams} />;
  }

  const worker = await getMyWorkerRecord(organisationId);
  if (!worker) notFound();
  const mine = await listMyTimesheets(organisationId);
  return (
    <>
      <Header
        context={context}
        intro="Your weekly timesheets, built from your clock-ins, clock-outs, breaks and approved corrections. Submit each week once it has ended."
      />
      {mine.length === 0 ? (
        <EmptyState
          title="No timesheets yet."
          description="Timesheets appear here once you have worked a shift."
        />
      ) : (
        <ul aria-label="My timesheets" className="flex flex-col gap-3">
          {mine.map((sheet) => (
            <li
              key={sheet.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/app/organisations/${organisationId}/timesheets/${sheet.id}`}
                  className="font-display text-base font-semibold text-primary underline underline-offset-4"
                >
                  {formatPeriod(sheet.periodStart, sheet.periodEnd)}
                </Link>
                <TimesheetStatusBadge status={sheet.status} />
              </div>
              <p className="text-sm">
                <span className="font-semibold tabular-nums">
                  {formatWorkedMinutes(sheet.totalWorkedMinutes)}
                </span>{" "}
                worked · {sheet.entryCount === 1 ? "1 shift" : `${sheet.entryCount} shifts`}
                <span className="block text-xs text-muted-foreground">
                  From your attendance — not typed in
                </span>
              </p>
              {sheet.canSubmit ? (
                <StatusChip tone="success" className="w-fit">
                  Ready to submit
                </StatusChip>
              ) : sheet.status === "open" || sheet.status === "rejected" ? (
                <ul aria-label="Before you can submit" className="flex flex-wrap gap-1">
                  {sheet.blockingReasons.map((reason) => (
                    <li key={reason}>
                      <StatusChip tone={reason === "PERIOD_NOT_ENDED" ? "neutral" : "warning"}>
                        {blockingReasonLabel(reason)}
                      </StatusChip>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const FACILITY_STATE_TONE: Record<TimesheetFacilityState, "info" | "success" | "danger"> = {
  not_required: "info",
  pending: "info",
  signed_off: "success",
  disputed: "danger",
};

async function FacilityTimesheets({
  context,
  rawState,
}: {
  context: OrganisationPageContext;
  rawState: string | undefined;
}) {
  const { organisationId, can } = context;
  if (can(CAPABILITIES.TIMESHEET_FACILITY_SIGNOFF) !== "granted") {
    return (
      <>
        <Header
          context={context}
          intro="Worked time at your facility, approved by your agencies."
        />
        <StepUpNotice returnTo={`/app/organisations/${organisationId}/timesheets`} />
      </>
    );
  }
  const entries = await listFacilityTimesheetEntries(organisationId);
  // Display filter over the facility's own (already loaded) projection.
  const states = Object.keys(FACILITY_STATE_LABELS) as TimesheetFacilityState[];
  const stateFilter = states.find((state) => state === rawState);
  const shown = stateFilter
    ? entries.filter((entry) => entry.facilityState === stateFilter)
    : entries;
  const base = `/app/organisations/${organisationId}/timesheets` as const;
  const quick = (state: TimesheetFacilityState) => ({
    count: entries.filter((entry) => entry.facilityState === state).length,
    href: `${base}?state=${state}` as Route,
    active: stateFilter === state,
  });
  const pending = quick("pending");
  const signedOff = quick("signed_off");
  const disputed = quick("disputed");
  return (
    <>
      <Header
        context={context}
        intro="Worked time at your facility that an agency has approved. Sign off each entry, or raise a discrepancy if something is wrong; you cannot change times here. Times are in the facility's timezone."
      />
      {entries.length > 0 ? (
        <>
          <KpiFilterGroup label="Sign-off summary">
            <KpiFilterCard
              label="Awaiting sign-off"
              value={pending.count}
              supporting="Approved by the agency"
              icon={<WorkspaceNavIcon name="timesheets" />}
              href={pending.href}
              active={pending.active}
            />
            <KpiFilterCard
              label="Signed off"
              value={signedOff.count}
              supporting="Confirmed by your facility"
              icon={<WorkspaceNavIcon name="compliance" />}
              href={signedOff.href}
              active={signedOff.active}
            />
            <KpiFilterCard
              label="Discrepancies raised"
              value={disputed.count}
              supporting="Waiting for the agency"
              icon={<WorkspaceNavIcon name="attendance" />}
              href={disputed.href}
              active={disputed.active}
            />
          </KpiFilterGroup>
          <FilterBar
            key={stateFilter ?? "all"}
            label="Filter entries"
            resetHref={stateFilter ? (base as Route) : undefined}
          >
            <FilterSelect
              label="Sign-off"
              id="entry-state"
              name="state"
              defaultValue={stateFilter ?? ""}
            >
              <option value="">All entries</option>
              {states.map((state) => (
                <option key={state} value={state}>
                  {FACILITY_STATE_LABELS[state]}
                </option>
              ))}
            </FilterSelect>
          </FilterBar>
        </>
      ) : null}
      {entries.length === 0 ? (
        <EmptyState title="No entries awaiting sign-off." />
      ) : shown.length === 0 ? (
        <EmptyState
          title="No entries in this state."
          action={
            <Link
              href={base}
              className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4"
            >
              Show all entries
            </Link>
          }
        />
      ) : (
        <DataTableRegion aria-label="Facility timesheet entries">
          <DataTable className="min-w-[900px]">
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>Worker</DataTableHeaderCell>
                <DataTableHeaderCell>Date</DataTableHeaderCell>
                <DataTableHeaderCell>Scheduled</DataTableHeaderCell>
                <DataTableHeaderCell>Worked from – to</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Breaks</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Worked</DataTableHeaderCell>
                <DataTableHeaderCell>Sign-off</DataTableHeaderCell>
                <DataTableHeaderCell>
                  <span className="sr-only">Details</span>
                </DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {shown.map((entry) => {
                const shift = {
                  startAt: entry.scheduledStartAt,
                  endAt: entry.scheduledEndAt,
                  timezone: entry.timezone,
                };
                const worker = entry.workerName ?? "Worker";
                return (
                  <DataTableRow key={entry.id}>
                    <DataTableCell>
                      <div className="font-medium">{worker}</div>
                      <div className="text-muted-foreground">{entry.agencyName}</div>
                    </DataTableCell>
                    <DataTableCell>
                      {formatShiftDate(shift)}
                      <div className="text-muted-foreground">
                        {entry.facilityName} · {entry.locationName}
                      </div>
                    </DataTableCell>
                    <DataTableCell>{formatShiftTimeRange(shift)}</DataTableCell>
                    <DataTableCell>
                      {formatLocalClockTime(entry.effectiveStartAt, entry.timezone)} –{" "}
                      {formatLocalClockTime(entry.effectiveEndAt, entry.timezone)}
                      {entry.hadAttendanceException ? (
                        <div className="text-xs text-muted-foreground">Reviewed by the agency</div>
                      ) : null}
                    </DataTableCell>
                    <DataTableCell numeric>{formatWorkedMinutes(entry.breakMinutes)}</DataTableCell>
                    <DataTableCell numeric className="font-medium">
                      {formatWorkedMinutes(entry.workedMinutes)}
                    </DataTableCell>
                    <DataTableCell>
                      <div className="flex flex-col gap-2">
                        <FacilityStateBadge state={entry.facilityState} />
                        {entry.disputeReason && entry.facilityState === "disputed" ? (
                          <span className="text-xs text-muted-foreground">
                            {DISPUTE_REASON_LABELS[entry.disputeReason]}
                          </span>
                        ) : null}
                        {entry.facilityState === "pending" ? (
                          <FacilityDecisionForms
                            organisationId={organisationId}
                            entryId={entry.id}
                            revision={entry.revision}
                            workerName={worker}
                          />
                        ) : null}
                      </div>
                    </DataTableCell>
                    <DataTableCell>
                      <DetailDrawerTrigger
                        triggerLabel="Details"
                        triggerAccessibleLabel={`Details for ${worker}, ${formatShiftDate(shift)}`}
                        title={worker}
                        description={`${entry.agencyName} · ${formatShiftDate(shift)}`}
                      >
                        <KeyValueList
                          items={[
                            {
                              label: "Sign-off",
                              value: (
                                <StatusChip tone={FACILITY_STATE_TONE[entry.facilityState]}>
                                  {FACILITY_STATE_LABELS[entry.facilityState]}
                                </StatusChip>
                              ),
                            },
                            ...(entry.disputeReason && entry.facilityState === "disputed"
                              ? [
                                  {
                                    label: "Discrepancy",
                                    value: DISPUTE_REASON_LABELS[entry.disputeReason],
                                  },
                                ]
                              : []),
                            { label: "Agency", value: entry.agencyName },
                            {
                              label: "Location",
                              value: `${entry.facilityName} · ${entry.locationName}`,
                            },
                            { label: "Scheduled", value: formatShiftTimeRange(shift) },
                            {
                              label: "Worked from – to",
                              value: `${formatLocalClockTime(entry.effectiveStartAt, entry.timezone)} – ${formatLocalClockTime(entry.effectiveEndAt, entry.timezone)}`,
                            },
                            { label: "Breaks", value: formatWorkedMinutes(entry.breakMinutes) },
                            { label: "Worked", value: formatWorkedMinutes(entry.workedMinutes) },
                            { label: "Timezone", value: entry.timezone },
                            { label: "Revision", value: entry.revision },
                          ]}
                        />
                        <p className="text-sm text-muted-foreground">
                          Sign off or raise a discrepancy from the table. You cannot change times
                          here.
                        </p>
                      </DetailDrawerTrigger>
                    </DataTableCell>
                  </DataTableRow>
                );
              })}
            </tbody>
          </DataTable>
        </DataTableRegion>
      )}
    </>
  );
}
