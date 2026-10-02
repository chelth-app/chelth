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
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import {
  AttendanceStateBadge,
  listAgencyAttendance,
  listOpenExceptions,
} from "@/features/attendance";
import { FillBadge, listAgencyShifts, listAssignmentIssues } from "@/features/shifts";
import { listAgencyTimesheets } from "@/features/timesheets";
import { listWorkers } from "@/features/workforce";
import { CAPABILITIES, type CapabilityKey, type CapabilityState } from "@/lib/authz";
import {
  ASSIGNMENT_ISSUE_SEVERITY_LABELS,
  ASSIGNMENT_ISSUE_TYPE_LABELS,
  formatShiftDate,
  formatShiftTimeRange,
  todayIsoDate,
} from "@/lib/domain/shifts";
import { WORKER_STATUS_LABELS, WORKER_STATUSES, type WorkerStatus } from "@/lib/domain/vocabulary";

const PANEL_ROWS = 8;

const WORKER_TONE: Record<WorkerStatus, StatusTone> = {
  onboarding: "info",
  active: "success",
  inactive: "neutral",
  suspended: "warning",
  terminated: "danger",
};

/**
 * Agency Operations Overview (P2). Composed ONLY from existing queries, each
 * gated exactly as on its own page: no trends, forecasts, scores or charts.
 * Answers: what needs attention, what is happening today, what is coming up.
 */
export async function AgencyOperationsOverview({
  organisationId,
  can,
}: {
  organisationId: string;
  can: (capability: CapabilityKey) => CapabilityState;
}) {
  const held = (capability: CapabilityKey) => can(capability) !== "not_held";
  const showShifts = held(CAPABILITIES.SHIFT_VIEW);
  // As on Operations: the attention queue needs both grants.
  const showIssues =
    can(CAPABILITIES.ASSIGNMENT_VIEW) === "granted" &&
    can(CAPABILITIES.COMPLIANCE_VIEW) === "granted";
  const showAttendance = held(CAPABILITIES.ATTENDANCE_VIEW);
  const showTimesheets = held(CAPABILITIES.TIMESHEET_VIEW);
  const showWorkforce = can(CAPABILITIES.WORKER_VIEW) === "granted";
  if (!showShifts && !showIssues && !showAttendance && !showTimesheets && !showWorkforce) {
    return null;
  }

  const today = todayIsoDate();
  const [openShifts, issues, todayAttendance, exceptions, submittedTimesheets, workers] =
    await Promise.all([
      showShifts
        ? listAgencyShifts(organisationId, { status: "open", from: today })
        : Promise.resolve([]),
      showIssues ? listAssignmentIssues(organisationId) : Promise.resolve([]),
      showAttendance ? listAgencyAttendance(organisationId, {}) : Promise.resolve([]),
      showAttendance ? listOpenExceptions(organisationId) : Promise.resolve([]),
      showTimesheets
        ? listAgencyTimesheets(organisationId, { status: "submitted" })
        : Promise.resolve([]),
      showWorkforce ? listWorkers(organisationId) : Promise.resolve([]),
    ]);

  const base = `/app/organisations/${organisationId}`;
  const notFullyStaffed = openShifts.filter((shift) => shift.fillState !== "filled").length;
  const urgentIssues = issues.filter((issue) => issue.severity === "urgent").length;
  const needsReview = todayAttendance.filter((row) => row.needsReview).length;
  const withDiscrepancy = submittedTimesheets.filter((sheet) => sheet.disputedCount > 0).length;
  const workerCounts = WORKER_STATUSES.map((status) => ({
    status,
    count: workers.filter((worker) => worker.status === status).length,
  })).filter((entry) => entry.count > 0);

  return (
    <>
      <KpiFilterGroup label="Operations summary">
        {showShifts ? (
          <KpiFilterCard
            label="Open shifts"
            value={openShifts.length}
            supporting={`${notFullyStaffed} not fully staffed`}
            icon={<WorkspaceNavIcon name="shifts" />}
            href={`${base}/shifts?status=open&from=${today}` as Route}
          />
        ) : null}
        {showIssues ? (
          <KpiFilterCard
            label="Assignments needing attention"
            value={issues.length}
            supporting={urgentIssues > 0 ? `${urgentIssues} urgent` : "None urgent"}
            icon={<WorkspaceNavIcon name="operations" />}
            href={`${base}/operations` as Route}
          />
        ) : null}
        {showAttendance ? (
          <KpiFilterCard
            label="Attendance to review today"
            value={needsReview}
            supporting={`${exceptions.length} open exceptions`}
            icon={<WorkspaceNavIcon name="attendance" />}
            href={`${base}/attendance` as Route}
          />
        ) : null}
        {showTimesheets ? (
          <KpiFilterCard
            label="Timesheets to approve"
            value={submittedTimesheets.length}
            supporting={
              withDiscrepancy > 0
                ? `${withDiscrepancy} with facility discrepancies`
                : "Submitted by workers"
            }
            icon={<WorkspaceNavIcon name="timesheets" />}
            href={`${base}/timesheets?status=submitted` as Route}
          />
        ) : null}
      </KpiFilterGroup>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {showAttendance ? (
            <Panel
              title="Today's schedule"
              titleId="today-schedule-heading"
              description="Accepted assignments today, in each facility's timezone. Records needing review first."
              action={<PanelLink href={`${base}/attendance` as Route}>View attendance</PanelLink>}
            >
              {todayAttendance.length === 0 ? (
                <EmptyState headingLevel={3} title="No one is scheduled today." />
              ) : (
                <DataTableRegion aria-label="Today's schedule table">
                  <DataTable className="min-w-[36rem]">
                    <DataTableHead>
                      <tr>
                        <DataTableHeaderCell>Worker</DataTableHeaderCell>
                        <DataTableHeaderCell>Facility</DataTableHeaderCell>
                        <DataTableHeaderCell>Time</DataTableHeaderCell>
                        <DataTableHeaderCell>Status</DataTableHeaderCell>
                      </tr>
                    </DataTableHead>
                    <tbody>
                      {todayAttendance.slice(0, PANEL_ROWS).map((row) => (
                        <DataTableRow key={row.assignmentId}>
                          <DataTableCell className="font-medium">
                            {row.attendanceId ? (
                              <Link
                                href={`${base}/attendance/${row.attendanceId}` as Route}
                                className="text-primary underline underline-offset-4"
                              >
                                {row.workerName ?? "Worker"}
                              </Link>
                            ) : (
                              (row.workerName ?? "Worker")
                            )}
                          </DataTableCell>
                          <DataTableCell>{row.facilityName}</DataTableCell>
                          <DataTableCell>{formatShiftTimeRange(row)}</DataTableCell>
                          <DataTableCell>
                            <AttendanceStateBadge
                              clockState={row.clockState}
                              needsReview={row.needsReview}
                            />
                          </DataTableCell>
                        </DataTableRow>
                      ))}
                    </tbody>
                  </DataTable>
                </DataTableRegion>
              )}
              {todayAttendance.length > PANEL_ROWS ? (
                <p className="text-sm text-muted-foreground">
                  Showing {PANEL_ROWS} of {todayAttendance.length}.
                </p>
              ) : null}
            </Panel>
          ) : null}

          {showShifts ? (
            <Panel
              title="Upcoming open shifts"
              titleId="upcoming-shifts-heading"
              description="Open shifts from today onwards, earliest first."
              action={
                <PanelLink href={`${base}/shifts?status=open&from=${today}` as Route}>
                  View shifts
                </PanelLink>
              }
            >
              {openShifts.length === 0 ? (
                <EmptyState headingLevel={3} title="No open shifts coming up." />
              ) : (
                <DataTableRegion aria-label="Upcoming open shifts table">
                  <DataTable className="min-w-[36rem]">
                    <DataTableHead>
                      <tr>
                        <DataTableHeaderCell>Shift</DataTableHeaderCell>
                        <DataTableHeaderCell>Date</DataTableHeaderCell>
                        <DataTableHeaderCell>Time</DataTableHeaderCell>
                        <DataTableHeaderCell>Staffing</DataTableHeaderCell>
                      </tr>
                    </DataTableHead>
                    <tbody>
                      {openShifts.slice(0, PANEL_ROWS).map((shift) => (
                        <DataTableRow key={shift.id}>
                          <DataTableCell>
                            <Link
                              href={`${base}/shifts/${shift.id}` as Route}
                              className="font-medium text-primary underline underline-offset-4"
                            >
                              {shift.facilityName}
                            </Link>
                            <div className="text-muted-foreground">{shift.disciplineName}</div>
                          </DataTableCell>
                          <DataTableCell>{formatShiftDate(shift)}</DataTableCell>
                          <DataTableCell>{formatShiftTimeRange(shift)}</DataTableCell>
                          <DataTableCell>
                            <FillBadge
                              fillState={shift.fillState}
                              activeCount={shift.activeCount}
                              requestedHeadcount={shift.requestedHeadcount}
                            />
                          </DataTableCell>
                        </DataTableRow>
                      ))}
                    </tbody>
                  </DataTable>
                </DataTableRegion>
              )}
              {openShifts.length > PANEL_ROWS ? (
                <p className="text-sm text-muted-foreground">
                  Showing {PANEL_ROWS} of {openShifts.length}.
                </p>
              ) : null}
            </Panel>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {showIssues ? (
            <Panel
              title="Needs attention"
              titleId="needs-attention-heading"
              description="Upcoming assignments Chelth found a problem with."
              action={<PanelLink href={`${base}/operations` as Route}>View all</PanelLink>}
            >
              {issues.length === 0 ? (
                <EmptyState headingLevel={3} title="Nothing needs attention." />
              ) : (
                <ul
                  aria-label="Assignments needing attention"
                  className="flex flex-col divide-y divide-border"
                >
                  {issues.slice(0, 5).map((issue) => (
                    <li key={issue.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                      <Link
                        href={`${base}/shifts/${issue.shiftId}` as Route}
                        className="text-sm font-medium text-primary underline underline-offset-4"
                      >
                        {issue.workerName ?? "Worker"} · {issue.facilityName}
                      </Link>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <StatusChip tone={issue.severity === "urgent" ? "danger" : "attention"}>
                          {ASSIGNMENT_ISSUE_SEVERITY_LABELS[issue.severity]}
                        </StatusChip>
                        {ASSIGNMENT_ISSUE_TYPE_LABELS[issue.issueType]} · {formatShiftDate(issue)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ) : null}

          {showWorkforce ? (
            <Panel
              title="Workforce"
              titleId="workforce-summary-heading"
              description="Worker records by status."
              action={<PanelLink href={`${base}/workforce` as Route}>View workforce</PanelLink>}
            >
              {workerCounts.length === 0 ? (
                <EmptyState headingLevel={3} title="No workers yet." />
              ) : (
                <ul aria-label="Workers by status" className="flex flex-col gap-2">
                  {workerCounts.map(({ status, count }) => (
                    <li key={status} className="flex items-center justify-between gap-3 text-sm">
                      <StatusChip tone={WORKER_TONE[status]}>
                        {WORKER_STATUS_LABELS[status]}
                      </StatusChip>
                      <span className="font-semibold tabular-nums">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
