import type { Route } from "next";
import Link from "next/link";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiFilterCard, KpiFilterGroup } from "@/components/ui/kpi-filter-card";
import { Panel, PanelLink } from "@/components/ui/panel";
import { FillBadge, listFacilityShifts, ShiftStatusBadge } from "@/features/shifts";
import { listFacilityTimesheetEntries } from "@/features/timesheets";
import { CAPABILITIES, type CapabilityKey, type CapabilityState } from "@/lib/authz";
import { formatShiftDate, formatShiftTimeRange, hasEnded, localDate } from "@/lib/domain/shifts";
import { formatWorkedMinutes } from "@/lib/domain/timesheets";

const PANEL_ROWS = 8;

/**
 * Facility Operations Overview (P2, facility scope). Uses ONLY the facility's
 * own projections, gated as on their pages:
 *  - shift.view → the facility shift projection (counts, no worker names);
 *  - timesheet.facility_signoff (granted) → the facility's own sign-off
 *    entries (an audited, de-duplicated read — the same one the Timesheets
 *    page makes).
 * Worker names and attendance stay on each request page, whose per-shift
 * reads are individually audited; they are deliberately not fanned out here.
 * No agency-internal issues, pay, pricing, coordinates or audit data.
 */
export async function FacilityOperationsOverview({
  organisationId,
  can,
}: {
  organisationId: string;
  can: (capability: CapabilityKey) => CapabilityState;
}) {
  const showRequests = can(CAPABILITIES.SHIFT_VIEW) !== "not_held";
  const showSignoff = can(CAPABILITIES.TIMESHEET_FACILITY_SIGNOFF) === "granted";
  if (!showRequests && !showSignoff) return null;

  const [shifts, entries] = await Promise.all([
    showRequests ? listFacilityShifts(organisationId) : Promise.resolve([]),
    showSignoff ? listFacilityTimesheetEntries(organisationId) : Promise.resolve([]),
  ]);

  const base = `/app/organisations/${organisationId}`;
  const upcoming = shifts
    .filter(
      (shift) => !hasEnded(shift) && (shift.status === "open" || shift.status === "submitted"),
    )
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const awaitingAgency = upcoming.filter((shift) => shift.status === "submitted").length;
  const open = upcoming.filter((shift) => shift.status === "open");
  const notFullyStaffed = open.filter((shift) => shift.fillState !== "filled").length;
  const now = new Date().toISOString();
  const today = open.filter(
    (shift) => localDate(shift.startAt, shift.timezone) === localDate(now, shift.timezone),
  );
  const expectedToday = today.reduce((sum, shift) => sum + shift.acceptedCount, 0);
  const pending = entries.filter((entry) => entry.facilityState === "pending");

  return (
    <>
      <KpiFilterGroup label="Facility summary">
        {showRequests ? (
          <>
            <KpiFilterCard
              label="Awaiting agency"
              value={awaitingAgency}
              supporting="Requests not yet opened"
              icon={<WorkspaceNavIcon name="requests" />}
              href={`${base}/staffing-requests?status=submitted&when=upcoming` as Route}
            />
            <KpiFilterCard
              label="Open requests"
              value={open.length}
              supporting={`${notFullyStaffed} not fully staffed`}
              icon={<WorkspaceNavIcon name="shifts" />}
              href={`${base}/staffing-requests?status=open&when=upcoming` as Route}
            />
            <KpiFilterCard
              label="Workers expected today"
              value={expectedToday}
              supporting={`Across ${today.length} shift${today.length === 1 ? "" : "s"} today`}
              icon={<WorkspaceNavIcon name="workforce" />}
            />
          </>
        ) : null}
        {showSignoff ? (
          <KpiFilterCard
            label="Timesheets to sign off"
            value={pending.length}
            supporting="Entries approved by agencies"
            icon={<WorkspaceNavIcon name="timesheets" />}
            href={`${base}/timesheets?state=pending` as Route}
          />
        ) : null}
      </KpiFilterGroup>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {showRequests ? (
          <Panel
            title="Today and upcoming"
            titleId="facility-upcoming-heading"
            description="Requests and shifts at your facility, earliest first. Who is coming and attendance are on each request."
            action={
              <PanelLink href={`${base}/staffing-requests` as Route}>View requests</PanelLink>
            }
          >
            {upcoming.length === 0 ? (
              <EmptyState headingLevel={3} title="Nothing scheduled or requested ahead." />
            ) : (
              <DataTableRegion aria-label="Upcoming requests table">
                <DataTable className="min-w-[36rem]">
                  <DataTableHead>
                    <tr>
                      <DataTableHeaderCell>Request</DataTableHeaderCell>
                      <DataTableHeaderCell>Time</DataTableHeaderCell>
                      <DataTableHeaderCell>Status</DataTableHeaderCell>
                      <DataTableHeaderCell>Staffing</DataTableHeaderCell>
                    </tr>
                  </DataTableHead>
                  <tbody>
                    {upcoming.slice(0, PANEL_ROWS).map((shift) => (
                      <DataTableRow key={shift.id}>
                        <DataTableCell>
                          <Link
                            href={`${base}/staffing-requests/${shift.id}` as Route}
                            className="font-medium text-primary underline underline-offset-4"
                          >
                            {shift.disciplineName} · {formatShiftDate(shift)}
                          </Link>
                          <div className="text-muted-foreground">
                            {shift.agencyName} · {shift.locationName}
                          </div>
                        </DataTableCell>
                        <DataTableCell>{formatShiftTimeRange(shift)}</DataTableCell>
                        <DataTableCell>
                          <ShiftStatusBadge status={shift.status} />
                        </DataTableCell>
                        <DataTableCell>
                          {shift.status === "open" ? (
                            <FillBadge
                              fillState={shift.fillState}
                              activeCount={shift.activeCount}
                              requestedHeadcount={shift.requestedHeadcount}
                            />
                          ) : (
                            <span className="text-muted-foreground">
                              {shift.requestedHeadcount} needed
                            </span>
                          )}
                        </DataTableCell>
                      </DataTableRow>
                    ))}
                  </tbody>
                </DataTable>
              </DataTableRegion>
            )}
            {upcoming.length > PANEL_ROWS ? (
              <p className="text-sm text-muted-foreground">
                Showing {PANEL_ROWS} of {upcoming.length}.
              </p>
            ) : null}
          </Panel>
        ) : null}

        {showSignoff ? (
          <Panel
            title="Awaiting sign-off"
            titleId="facility-signoff-heading"
            description="Worked time your agencies have approved."
            action={
              <PanelLink href={`${base}/timesheets?state=pending` as Route}>Sign off</PanelLink>
            }
          >
            {pending.length === 0 ? (
              <EmptyState headingLevel={3} title="Nothing to sign off." />
            ) : (
              <ul
                aria-label="Entries awaiting sign-off"
                className="flex flex-col divide-y divide-border"
              >
                {pending.slice(0, 5).map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">{entry.workerName ?? "Worker"}</span>
                      <span className="block text-xs text-muted-foreground">
                        {entry.agencyName} ·{" "}
                        {formatShiftDate({
                          startAt: entry.scheduledStartAt,
                          timezone: entry.timezone,
                        })}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatWorkedMinutes(entry.workedMinutes)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
      </div>
    </>
  );
}
