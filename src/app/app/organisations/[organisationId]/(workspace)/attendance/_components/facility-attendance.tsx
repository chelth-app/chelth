import Link from "next/link";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { RefKpiCard, RefPanel } from "@/components/reference/locked-reference";
import { PageHeader } from "@/components/ui/page-header";
import { listFacilityCoverage } from "@/features/shifts";
import { localDate } from "@/lib/domain/shifts";

import { LockedEmpty } from "../../(finance)/_components/finance-locked";
import {
  coverageNeedsAttention,
  FacilityCoverageTable,
} from "../../_components/facility-coverage-table";

function isoDay(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Facility Attendance (P0-E9-3K): today's attendance for this facility's own
 * shifts — scheduled, checked in, on break, completed, needs attention — from
 * the audited facility projection. Derived states only: never coordinates,
 * geofence evidence or the agency's review tools (those stay with the agency).
 * Shifts still running from yesterday (overnight) are included.
 */
export async function FacilityAttendance({
  organisationId,
  organisationName,
}: {
  organisationId: string;
  organisationName: string;
}) {
  const rows = (await listFacilityCoverage(organisationId, isoDay(-1), isoDay(1))).filter(
    (row) => row.attendance !== null,
  );
  const now = new Date();
  const nowIso = now.toISOString();
  const today = rows.filter(
    (row) =>
      localDate(row.startAt, row.timezone) === localDate(nowIso, row.timezone) ||
      (new Date(row.startAt) <= now && new Date(row.endAt) > now),
  );
  const count = (state: string) =>
    today.filter((row) => row.attendance?.clockState === state).length;
  const attention = today.filter((row) => coverageNeedsAttention(row, now)).length;
  // P0-E9-4A.1: several supplying agencies ⇒ the same totals per agency.
  const byAgency = [...new Set(today.map((row) => row.agencyName))].sort().map((agencyName) => {
    const rowsFor = today.filter((row) => row.agencyName === agencyName);
    return {
      agencyName,
      scheduled: rowsFor.length,
      checkedIn: rowsFor.filter(
        (row) =>
          row.attendance?.clockState === "clocked_in" || row.attendance?.clockState === "on_break",
      ).length,
      attention: rowsFor.filter((row) => coverageNeedsAttention(row, now)).length,
    };
  });

  return (
    <div className="chelth-locked flex flex-col gap-[13px]">
      <PageHeader
        variant="reference"
        className="xl:mb-1"
        title="Attendance"
        back={
          <Link
            href={`/app/organisations/${organisationId}`}
            className="text-primary underline underline-offset-4"
          >
            {organisationName}
          </Link>
        }
        description={
          <p>
            Who is expected at your facility today and who has checked in. Your agency handles
            corrections.
          </p>
        }
      />
      <section
        aria-label="Attendance today"
        className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-[13px]"
      >
        <RefKpiCard
          label="Scheduled Today"
          value={today.length}
          supporting="Workers on today's shifts"
          glyph="people"
          icon={<WorkspaceNavIcon name="workforce" strokeWidth={2.4} duotone />}
          tone="teal"
        />
        <RefKpiCard
          label="Checked In"
          value={count("clocked_in") + count("on_break")}
          supporting={`${count("on_break")} on break`}
          glyph="clock"
          icon={<WorkspaceNavIcon name="attendance" strokeWidth={2.4} duotone />}
          tone="teal"
        />
        <RefKpiCard
          label="Completed"
          value={count("clocked_out")}
          supporting="Checked out today"
          glyph="calendar"
          tone="info"
        />
        <RefKpiCard
          label="Needs Attention"
          value={attention}
          supporting="Not checked in, or under review"
          glyph="alert"
          tone={attention > 0 ? "warning" : "info"}
        />
      </section>
      {byAgency.length > 1 ? (
        <RefPanel title="By agency" titleId="facility-attendance-agencies-heading">
          <ul
            aria-label="Attendance by agency"
            className="flex flex-col divide-y divide-border px-[5px] text-sm"
          >
            {byAgency.map((entry) => (
              <li key={entry.agencyName} className="flex flex-wrap justify-between gap-2 py-2.5">
                <span className="font-medium text-chelth-navy">{entry.agencyName}</span>
                <span className="text-slate-700">
                  {entry.scheduled} scheduled · {entry.checkedIn} checked in
                  {entry.attention > 0 ? ` · ${entry.attention} need attention` : ""}
                </span>
              </li>
            ))}
          </ul>
        </RefPanel>
      ) : null}
      <RefPanel title="Today" titleId="facility-attendance-heading">
        {today.length === 0 ? (
          <LockedEmpty
            icon="attendance"
            title="No one is scheduled today."
            note="Workers on today's shifts at your facility appear here as they check in and out."
          />
        ) : (
          <FacilityCoverageTable
            organisationId={organisationId}
            rows={today}
            label="Attendance today"
            showReadiness={false}
          />
        )}
      </RefPanel>
    </div>
  );
}
