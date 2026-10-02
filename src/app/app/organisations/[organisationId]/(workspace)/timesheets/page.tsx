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
import { FilterBar, FilterField, FilterSelect } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
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
  listAgencyTimesheets,
  listFacilityTimesheetEntries,
  listMyTimesheets,
  timesheetFilterSchema,
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
  TIMESHEET_STATUS_LABELS,
  TIMESHEET_STATUSES,
  type TimesheetFacilityState,
  type TimesheetStatus,
} from "@/lib/domain/timesheets";

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
    const raw = await searchParams;
    const filter = timesheetFilterSchema.parse({
      period: first(raw.period),
      status: first(raw.status),
    });
    const [rows, inPeriod] = await Promise.all([
      listAgencyTimesheets(organisationId, filter),
      // Quick-filter counts: the same query for the chosen week, any status.
      listAgencyTimesheets(organisationId, { period: filter.period }),
    ]);
    const base = `/app/organisations/${organisationId}/timesheets` as const;
    const quick = (status: TimesheetStatus) => {
      const query = new URLSearchParams({
        ...(filter.period ? { period: filter.period } : {}),
        status,
      });
      return {
        count: inPeriod.filter((row) => row.status === status).length,
        href: `${base}?${query.toString()}` as Route,
        active: filter.status === status,
      };
    };
    const toApprove = quick("submitted");
    const open = quick("open");
    const returned = quick("rejected");
    const awaitingFacility = quick("agency_approved");
    return (
      <>
        <Header
          context={context}
          intro="Weekly timesheets derived from attendance. Worked time comes only from clock events and approved corrections; it cannot be typed in. Submitted timesheets and discrepancies are listed first."
        />
        <KpiFilterGroup label="Timesheets by status">
          <KpiFilterCard
            label="To approve"
            value={toApprove.count}
            supporting="Submitted by workers"
            icon={<WorkspaceNavIcon name="timesheets" />}
            href={toApprove.href}
            active={toApprove.active}
          />
          <KpiFilterCard
            label="Open"
            value={open.count}
            supporting="Week in progress or not submitted"
            icon={<WorkspaceNavIcon name="shifts" />}
            href={open.href}
            active={open.active}
          />
          <KpiFilterCard
            label="Returned"
            value={returned.count}
            supporting="Sent back to the worker"
            icon={<WorkspaceNavIcon name="compliance" />}
            href={returned.href}
            active={returned.active}
          />
          <KpiFilterCard
            label="Awaiting facility"
            value={awaitingFacility.count}
            supporting="Approved, facility sign-off pending"
            icon={<WorkspaceNavIcon name="facilities" />}
            href={awaitingFacility.href}
            active={awaitingFacility.active}
          />
        </KpiFilterGroup>
        <FilterBar
          key={JSON.stringify(filter)}
          label="Filter timesheets"
          submitLabel="Show"
          resetHref={filter.period || filter.status ? (base as Route) : undefined}
        >
          <FilterField label="Week starting" htmlFor="timesheet-period">
            <Input id="timesheet-period" name="period" type="date" defaultValue={filter.period} />
          </FilterField>
          <FilterSelect
            label="Status"
            id="timesheet-status"
            name="status"
            defaultValue={filter.status ?? ""}
          >
            <option value="">Any status</option>
            {TIMESHEET_STATUSES.map((status) => (
              <option key={status} value={status}>
                {TIMESHEET_STATUS_LABELS[status]}
              </option>
            ))}
          </FilterSelect>
        </FilterBar>
        {rows.length === 0 ? (
          <EmptyState
            title="No timesheets match."
            description="Timesheets are created from attendance; change the week or status to see others."
          />
        ) : (
          <DataTableRegion aria-label="Agency timesheets table">
            <DataTable className="min-w-[840px]">
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Worker</DataTableHeaderCell>
                  <DataTableHeaderCell>Week</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell numeric>Worked</DataTableHeaderCell>
                  <DataTableHeaderCell numeric>Shifts</DataTableHeaderCell>
                  <DataTableHeaderCell>Needs attention</DataTableHeaderCell>
                  <DataTableHeaderCell>Facilities</DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                {rows.map((row) => (
                  <DataTableRow key={row.id}>
                    <DataTableCell className="font-medium">
                      <Link
                        href={`/app/organisations/${organisationId}/timesheets/${row.id}`}
                        className="text-primary underline underline-offset-4"
                      >
                        {row.workerName ?? "Worker"}
                      </Link>
                    </DataTableCell>
                    <DataTableCell>{formatPeriod(row.periodStart, row.periodEnd)}</DataTableCell>
                    <DataTableCell>
                      <TimesheetStatusBadge status={row.status} />
                      {row.revision > 1 ? (
                        <div className="text-xs text-muted-foreground">Revision {row.revision}</div>
                      ) : null}
                    </DataTableCell>
                    <DataTableCell numeric>
                      {formatWorkedMinutes(row.totalWorkedMinutes)}
                    </DataTableCell>
                    <DataTableCell numeric>{row.entryCount}</DataTableCell>
                    <DataTableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.issueCount > 0 ? (
                          <StatusChip tone="attention">
                            {row.issueCount === 1
                              ? "1 shift to resolve"
                              : `${row.issueCount} shifts to resolve`}
                          </StatusChip>
                        ) : null}
                        {row.disputedCount > 0 ? (
                          <StatusChip tone="danger">Discrepancy</StatusChip>
                        ) : null}
                        {row.pendingFacilityCount > 0 ? (
                          <StatusChip tone="info">Awaiting facility</StatusChip>
                        ) : null}
                      </div>
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {row.facilities.join(", ")}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </tbody>
            </DataTable>
          </DataTableRegion>
        )}
      </>
    );
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
