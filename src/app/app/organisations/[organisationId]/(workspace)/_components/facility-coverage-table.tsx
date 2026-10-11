import type { Route } from "next";
import Link from "next/link";

import { REF_TABLE, REF_TEXT, RefChip } from "@/components/reference/locked-reference";
import { DataTableRegion } from "@/components/ui/data-table";
import { AttendanceStateBadge } from "@/features/attendance";
import { ReadinessBadge } from "@/features/compliance";
import type { FacilityCoverageRow } from "@/features/shifts";
import {
  ASSIGNMENT_STATUS_LABELS,
  formatShiftDate,
  formatShiftTimeRange,
} from "@/lib/domain/shifts";
import { cn } from "@/lib/utils/cn";

/**
 * P0-E9-3K: true when an accepted worker has not checked in although the shift
 * has started, or the attendance record has an open exception. Uses only the
 * facility projection (no coordinates, no evidence).
 */
export function coverageNeedsAttention(row: FacilityCoverageRow, now = new Date()): boolean {
  if (!row.attendance) return false;
  if (row.attendance.needsReview) return true;
  return (
    row.assignmentStatus === "accepted" &&
    row.attendance.clockState === "not_started" &&
    new Date(row.startAt) <= now &&
    new Date(row.endAt) > now
  );
}

/**
 * Facility Coverage / Attendance rows (P0-E9-3K): who is serving the facility,
 * on which shift, their response and readiness for this facility, and — with
 * attendance.view — their attendance state. Each row links to the staffing
 * request it belongs to. No pay, contact, coordinates or other facilities.
 */
export function FacilityCoverageTable({
  organisationId,
  rows,
  label,
  showReadiness = true,
}: {
  organisationId: string;
  rows: FacilityCoverageRow[];
  label: string;
  showReadiness?: boolean;
}) {
  const showAttendance = rows.some((row) => row.attendance !== null);
  const now = new Date();
  return (
    <DataTableRegion aria-label={`${label} table`} className="rounded-none border-0 bg-transparent">
      <table className={cn(REF_TABLE, "min-w-[44rem]")}>
        <caption className="sr-only">{label}</caption>
        <thead className={REF_TEXT.tableHead}>
          <tr>
            <th scope="col">Worker</th>
            <th scope="col">Shift</th>
            <th scope="col">Location</th>
            <th scope="col">Status</th>
            {showAttendance ? <th scope="col">Attendance</th> : null}
          </tr>
        </thead>
        <tbody className={REF_TEXT.tableBody}>
          {rows.map((row) => {
            const attention = coverageNeedsAttention(row, now);
            return (
              <tr key={row.assignmentId}>
                <td className="py-2.5 pr-2 font-normal">
                  <span className="flex flex-col">
                    <span className="font-medium text-chelth-navy">
                      {row.workerName ?? "Worker"}
                    </span>
                    <span className="text-muted-foreground">{row.disciplineName}</span>
                  </span>
                </td>
                <td className="py-2.5">
                  <Link
                    href={
                      `/app/organisations/${organisationId}/staffing-requests/${row.shiftId}` as Route
                    }
                    className="flex flex-col text-chelth-navy hover:text-primary hover:underline hover:underline-offset-4"
                  >
                    <span className="font-medium">{formatShiftDate(row)}</span>
                    <span className="text-muted-foreground">{formatShiftTimeRange(row)}</span>
                  </Link>
                </td>
                <td className="py-2.5">
                  <span className="flex flex-col">
                    <span>{row.locationName}</span>
                    <span className="text-muted-foreground">{row.agencyName}</span>
                  </span>
                </td>
                <td className="py-2.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <RefChip
                      tone={row.assignmentStatus === "accepted" ? "success" : "info"}
                      className="font-normal"
                    >
                      {ASSIGNMENT_STATUS_LABELS[row.assignmentStatus]}
                    </RefChip>
                    {showReadiness && row.readiness && row.readiness !== "ready" ? (
                      <ReadinessBadge status={row.readiness} />
                    ) : null}
                  </span>
                </td>
                {showAttendance ? (
                  <td className="py-2.5">
                    {row.attendance ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        {attention && !row.attendance.needsReview ? (
                          <RefChip tone="warning" className="font-normal">
                            Not checked in
                          </RefChip>
                        ) : (
                          <AttendanceStateBadge
                            clockState={row.attendance.clockState}
                            needsReview={row.attendance.needsReview}
                          />
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </DataTableRegion>
  );
}
