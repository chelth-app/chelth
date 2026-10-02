import Link from "next/link";

import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { StatusChip } from "@/components/ui/status-chip";
import { formatLocalClockTime, GEOFENCE_RESULT_LABELS } from "@/lib/domain/attendance";
import { formatShiftDate, formatShiftTimeRange } from "@/lib/domain/shifts";
import { blockingReasonLabel, formatWorkedMinutes } from "@/lib/domain/timesheets";

import type { TimesheetEntryRow } from "../queries";
import { FacilityStateBadge } from "./badges";

type EntriesTableProps = {
  entries: TimesheetEntryRow[];
  /** Agency reviewers get a link to the full attendance history of each entry. */
  attendanceHref?: (attendanceId: string) => `/app/organisations/${string}`;
  showFacilityState: boolean;
};

/**
 * Scheduled vs worked, per entry. Every value is derived from attendance by
 * the database; this table only formats it (shift-local times, whole minutes).
 */
export function TimesheetEntriesTable({
  entries,
  attendanceHref,
  showFacilityState,
}: EntriesTableProps) {
  const included = entries.filter((entry) => entry.included);
  if (included.length === 0) {
    return <p className="text-sm text-muted-foreground">No work in this week.</p>;
  }
  return (
    <DataTableRegion aria-label="Timesheet entries">
      <DataTable className="min-w-[820px]">
        <DataTableHead>
          <tr>
            <DataTableHeaderCell>Shift</DataTableHeaderCell>
            <DataTableHeaderCell>Scheduled</DataTableHeaderCell>
            <DataTableHeaderCell>Clock in</DataTableHeaderCell>
            <DataTableHeaderCell>Clock out</DataTableHeaderCell>
            <DataTableHeaderCell>Breaks</DataTableHeaderCell>
            <DataTableHeaderCell numeric>Worked</DataTableHeaderCell>
            <DataTableHeaderCell>Status</DataTableHeaderCell>
          </tr>
        </DataTableHead>
        <tbody>
          {included.map((entry) => {
            const shift = {
              startAt: entry.scheduledStartAt,
              endAt: entry.scheduledEndAt,
              timezone: entry.timezone,
            };
            return (
              <DataTableRow key={entry.id}>
                <DataTableCell>
                  <div className="font-medium">{formatShiftDate(shift)}</div>
                  <div className="text-muted-foreground">
                    {entry.facilityName} · {entry.locationName}
                  </div>
                  {attendanceHref && entry.attendanceId ? (
                    <Link
                      href={attendanceHref(entry.attendanceId)}
                      className="text-xs text-primary underline underline-offset-4"
                    >
                      Attendance history
                    </Link>
                  ) : null}
                </DataTableCell>
                <DataTableCell>{formatShiftTimeRange(shift)}</DataTableCell>
                <DataTableCell>
                  {entry.notWorked
                    ? "—"
                    : formatLocalClockTime(entry.effectiveStartAt, entry.timezone)}
                  {entry.clockInLocation && entry.clockInLocation !== "not_required" ? (
                    <div className="text-xs text-muted-foreground">
                      {GEOFENCE_RESULT_LABELS[entry.clockInLocation]}
                    </div>
                  ) : null}
                </DataTableCell>
                <DataTableCell>
                  {entry.notWorked
                    ? "—"
                    : formatLocalClockTime(entry.effectiveEndAt, entry.timezone)}
                </DataTableCell>
                <DataTableCell>
                  {entry.breaks.length === 0 ? (
                    <span className="text-muted-foreground">None</span>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {entry.breaks.map((item, index) => (
                        <li key={`${entry.id}-break-${item.segment ?? index}`}>
                          {formatLocalClockTime(item.startAt, entry.timezone)} –{" "}
                          {item.endAt
                            ? formatLocalClockTime(item.endAt, entry.timezone)
                            : "not ended"}
                        </li>
                      ))}
                    </ul>
                  )}
                </DataTableCell>
                <DataTableCell numeric className="font-medium">
                  {entry.notWorked ? "Not worked" : formatWorkedMinutes(entry.workedMinutes)}
                </DataTableCell>
                <DataTableCell>
                  <div className="flex flex-col items-start gap-1">
                    {entry.blockingReasons.map((reason) => (
                      <StatusChip key={reason} tone="attention">
                        {blockingReasonLabel(reason)}
                      </StatusChip>
                    ))}
                    {entry.openExceptionTypes.length > 0 ? (
                      <StatusChip tone="attention">Exception to review</StatusChip>
                    ) : null}
                    {entry.approvedCorrections > 0 ? (
                      <StatusChip tone="neutral">
                        {entry.approvedCorrections === 1
                          ? "1 approved correction"
                          : `${entry.approvedCorrections} approved corrections`}
                      </StatusChip>
                    ) : null}
                    {entry.complete &&
                    entry.blockingReasons.length === 0 &&
                    entry.openExceptionTypes.length === 0 ? (
                      <StatusChip tone="success">Complete</StatusChip>
                    ) : null}
                    {showFacilityState ? <FacilityStateBadge state={entry.facilityState} /> : null}
                  </div>
                </DataTableCell>
              </DataTableRow>
            );
          })}
        </tbody>
      </DataTable>
    </DataTableRegion>
  );
}
