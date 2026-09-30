import Link from "next/link";

import { Badge } from "@/components/ui/badge";
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
    <div
      role="region"
      aria-label="Timesheet entries"
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-border bg-surface"
    >
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Shift
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Scheduled
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Clock in
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Clock out
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Breaks
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Worked
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {included.map((entry) => {
            const shift = {
              startAt: entry.scheduledStartAt,
              endAt: entry.scheduledEndAt,
              timezone: entry.timezone,
            };
            return (
              <tr key={entry.id} className="border-b border-border align-top last:border-0">
                <td className="px-3 py-2">
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
                </td>
                <td className="px-3 py-2">{formatShiftTimeRange(shift)}</td>
                <td className="px-3 py-2">
                  {entry.notWorked
                    ? "—"
                    : formatLocalClockTime(entry.effectiveStartAt, entry.timezone)}
                  {entry.clockInLocation && entry.clockInLocation !== "not_required" ? (
                    <div className="text-xs text-muted-foreground">
                      {GEOFENCE_RESULT_LABELS[entry.clockInLocation]}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  {entry.notWorked
                    ? "—"
                    : formatLocalClockTime(entry.effectiveEndAt, entry.timezone)}
                </td>
                <td className="px-3 py-2">
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
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {entry.notWorked ? "Not worked" : formatWorkedMinutes(entry.workedMinutes)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col items-start gap-1">
                    {entry.blockingReasons.map((reason) => (
                      <Badge key={reason} tone="warning">
                        {blockingReasonLabel(reason)}
                      </Badge>
                    ))}
                    {entry.openExceptionTypes.length > 0 ? (
                      <Badge tone="warning">Exception to review</Badge>
                    ) : null}
                    {entry.approvedCorrections > 0 ? (
                      <Badge tone="neutral">
                        {entry.approvedCorrections === 1
                          ? "1 approved correction"
                          : `${entry.approvedCorrections} approved corrections`}
                      </Badge>
                    ) : null}
                    {entry.complete &&
                    entry.blockingReasons.length === 0 &&
                    entry.openExceptionTypes.length === 0 ? (
                      <Badge tone="success">Complete</Badge>
                    ) : null}
                    {showFacilityState ? <FacilityStateBadge state={entry.facilityState} /> : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
