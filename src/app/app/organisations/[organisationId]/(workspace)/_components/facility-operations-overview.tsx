import type { Route } from "next";
import Link from "next/link";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import {
  InitialsAvatar,
  KpiAction,
  KpiNote,
  REF_TABLE,
  REF_TEXT,
  RefChip,
  RefKpiCard,
  RefPanel,
  RefPanelAction,
} from "@/components/reference/locked-reference";
import { DataTableRegion } from "@/components/ui/data-table";
import { FILL_TONE, listFacilityShifts, SHIFT_TONE } from "@/features/shifts";
import { listFacilityTimesheetEntries } from "@/features/timesheets";
import { CAPABILITIES, type CapabilityKey, type CapabilityState } from "@/lib/authz";
import {
  FILL_STATE_LABELS,
  formatShiftDate,
  formatShiftTimeRange,
  hasEnded,
  localDate,
  SHIFT_STATUS_LABELS,
} from "@/lib/domain/shifts";
import { formatWorkedMinutes } from "@/lib/domain/timesheets";
import { cn } from "@/lib/utils/cn";

import { LockedEmpty } from "../(finance)/_components/finance-locked";

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
 *
 * Presentation (P0-E8-QA-F1): the locked Overview family — RefKpiCard, RefPanel
 * and REF_TABLE — with the same facility data and gates as before.
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
    <div className="flex flex-col gap-[13px]">
      <section
        aria-label="Facility summary"
        className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-[13px]"
      >
        {showRequests ? (
          <>
            <RefKpiCard
              label="Awaiting Agency"
              value={awaitingAgency}
              supporting="Requests not yet opened"
              footer={<KpiAction>View requests</KpiAction>}
              glyph="document"
              icon={<WorkspaceNavIcon name="requests" strokeWidth={2.4} duotone />}
              tone="info"
              href={`${base}/staffing-requests?status=submitted&when=upcoming` as Route}
            />
            <RefKpiCard
              label="Open Requests"
              value={open.length}
              supporting="Upcoming and open"
              footer={
                <KpiNote tone={notFullyStaffed > 0 ? "warning" : "success"}>
                  {notFullyStaffed} not fully staffed
                </KpiNote>
              }
              glyph="calendar"
              icon={<WorkspaceNavIcon name="shifts" strokeWidth={2.4} duotone />}
              tone="teal"
              href={`${base}/staffing-requests?status=open&when=upcoming` as Route}
            />
            <RefKpiCard
              label="Workers Expected Today"
              value={expectedToday}
              supporting={`Across ${today.length} shift${today.length === 1 ? "" : "s"} today`}
              glyph="people"
              icon={<WorkspaceNavIcon name="workforce" strokeWidth={2.4} duotone />}
              tone="teal"
            />
          </>
        ) : null}
        {showSignoff ? (
          <RefKpiCard
            label="Timesheets to Sign Off"
            value={pending.length}
            supporting="Entries approved by agencies"
            footer={<KpiAction>Sign off</KpiAction>}
            glyph="document"
            icon={<WorkspaceNavIcon name="timesheets" strokeWidth={2.4} duotone />}
            tone="info"
            href={`${base}/timesheets?state=pending` as Route}
          />
        ) : null}
      </section>

      <div
        className={cn(
          "grid gap-4",
          showRequests && showSignoff && "xl:grid-cols-[minmax(0,1.787fr)_minmax(0,1fr)]",
        )}
      >
        {showRequests ? (
          <RefPanel
            title="Today and upcoming"
            titleId="facility-upcoming-heading"
            action={
              <RefPanelAction href={`${base}/staffing-requests` as Route}>
                View requests
              </RefPanelAction>
            }
          >
            {upcoming.length === 0 ? (
              <LockedEmpty
                icon="requests"
                title="Nothing scheduled or requested ahead."
                note="Requests and shifts at your facility appear here, earliest first."
              />
            ) : (
              <DataTableRegion
                aria-label="Upcoming requests table"
                className="mt-[9px] rounded-none border-0 bg-transparent"
              >
                <table className={cn(REF_TABLE, "min-w-[36rem] table-fixed")}>
                  <colgroup>
                    <col className="w-[38%]" />
                    <col className="w-[24%]" />
                    <col className="w-[15%]" />
                    <col className="w-[23%]" />
                  </colgroup>
                  <thead className={REF_TEXT.tableHead}>
                    <tr>
                      <th scope="col">Request</th>
                      <th scope="col">Time</th>
                      <th scope="col">Status</th>
                      <th scope="col">Staffing</th>
                    </tr>
                  </thead>
                  <tbody className={REF_TEXT.tableBody}>
                    {upcoming.slice(0, PANEL_ROWS).map((shift) => (
                      <tr key={shift.id}>
                        <td>
                          <span className="flex flex-col py-2">
                            <Link
                              href={`${base}/staffing-requests/${shift.id}` as Route}
                              className="font-medium text-chelth-navy hover:text-primary hover:underline hover:underline-offset-4"
                            >
                              {shift.disciplineName} · {formatShiftDate(shift)}
                            </Link>
                            <span className="truncate text-muted-foreground">
                              {shift.agencyName} · {shift.locationName}
                            </span>
                          </span>
                        </td>
                        <td>{formatShiftTimeRange(shift)}</td>
                        <td>
                          <RefChip tone={SHIFT_TONE[shift.status]} className="font-normal">
                            {SHIFT_STATUS_LABELS[shift.status]}
                          </RefChip>
                        </td>
                        <td>
                          {shift.status === "open" ? (
                            <RefChip tone={FILL_TONE[shift.fillState]} className="font-normal">
                              {FILL_STATE_LABELS[shift.fillState]} · {shift.activeCount} of{" "}
                              {shift.requestedHeadcount}
                            </RefChip>
                          ) : (
                            <span className="text-muted-foreground">
                              {shift.requestedHeadcount} needed
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DataTableRegion>
            )}
            {upcoming.length > PANEL_ROWS ? (
              <p className="px-[5px] pt-2 text-[12.75px] text-muted-foreground">
                Showing {PANEL_ROWS} of {upcoming.length}.
              </p>
            ) : null}
          </RefPanel>
        ) : null}

        {showSignoff ? (
          <RefPanel
            title="Awaiting sign-off"
            titleId="facility-signoff-heading"
            action={
              <RefPanelAction href={`${base}/timesheets?state=pending` as Route}>
                Sign off
              </RefPanelAction>
            }
          >
            {pending.length === 0 ? (
              <LockedEmpty
                icon="timesheets"
                title="Nothing to sign off."
                note="Worked time your agencies approve appears here."
              />
            ) : (
              <ul
                aria-label="Entries awaiting sign-off"
                className="mt-[9px] flex flex-col divide-y divide-[rgba(18,107,103,0.12)] px-[5px]"
              >
                {pending.slice(0, 5).map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 py-2.5">
                    <InitialsAvatar name={entry.workerName} size={36} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[14px] leading-5 font-semibold text-chelth-navy">
                        {entry.workerName ?? "Worker"}
                      </span>
                      <span className="truncate text-[12.5px] leading-[18px] text-slate-600">
                        {entry.agencyName} ·{" "}
                        {formatShiftDate({
                          startAt: entry.scheduledStartAt,
                          timezone: entry.timezone,
                        })}
                      </span>
                    </span>
                    <span className="text-[14px] font-semibold text-chelth-navy tabular-nums">
                      {formatWorkedMinutes(entry.workedMinutes)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </RefPanel>
        ) : null}
      </div>
    </div>
  );
}
