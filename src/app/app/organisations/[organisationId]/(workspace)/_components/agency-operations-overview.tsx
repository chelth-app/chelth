import type { Route } from "next";
import Link from "next/link";

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
import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { DataTableRegion } from "@/components/ui/data-table";
import { LocationPin } from "@/components/ui/location-pin";
import type { StatusTone } from "@/components/ui/status-chip";
import { listAgencyAttendance, listOpenExceptions } from "@/features/attendance";
import {
  type AgencyShiftSummary,
  FILL_TONE,
  listAgencyShifts,
  listAssignmentIssues,
  SHIFT_TONE,
} from "@/features/shifts";
import { listAgencyTimesheets } from "@/features/timesheets";
import { listWorkers } from "@/features/workforce";
import { CAPABILITIES, type CapabilityKey, type CapabilityState } from "@/lib/authz";
import {
  ATTENDANCE_STATE_LABELS,
  type AttendanceState,
  deriveAttendanceState,
} from "@/lib/domain/attendance";
import {
  disciplineNameParts,
  FILL_STATE_LABELS,
  formatShiftDate,
  formatShiftTimeRange,
  formatShiftTimeRangeParts,
  localDate,
  SHIFT_STATUS_LABELS,
  startsWithin,
  todayIsoDate,
} from "@/lib/domain/shifts";
import { WORKER_STATUS_LABELS, type WorkerStatus } from "@/lib/domain/vocabulary";
import { cn } from "@/lib/utils/cn";

/** Locked P2: five rows per panel table; the header action opens the full list. */
const PANEL_ROWS = 5;
const OUTLOOK_DAYS = 14;

/** Same tones as AttendanceStateBadge (features/attendance). */
const ATTENDANCE_TONE: Record<AttendanceState, StatusTone> = {
  not_started: "neutral",
  clocked_in: "info",
  on_break: "info",
  clocked_out: "success",
  needs_review: "warning",
};

/** The reference legend's four rows, in its order (terminated workers are former workers). */
const WORKFORCE_ROWS: { status: WorkerStatus; ring: string; dot: string }[] = [
  { status: "active", ring: "stroke-[#009c84]", dot: "bg-[#009c84]" },
  { status: "onboarding", ring: "stroke-[#2acca8]", dot: "bg-[#2acca8]" },
  { status: "inactive", ring: "stroke-warning-indicator", dot: "bg-warning-indicator" },
  { status: "suspended", ring: "stroke-danger-indicator", dot: "bg-danger-indicator" },
];

/** Status chip for a shift row: fill state while open, otherwise the shift status. */
function shiftChip(shift: AgencyShiftSummary): { tone: StatusTone; label: string } {
  if (shift.status === "open") {
    return shift.fillState === "unfilled"
      ? { tone: "danger", label: "Open" }
      : { tone: FILL_TONE[shift.fillState], label: FILL_STATE_LABELS[shift.fillState] };
  }
  return { tone: SHIFT_TONE[shift.status], label: SHIFT_STATUS_LABELS[shift.status] };
}

/**
 * Agency Operations Overview — the locked P2 composition rebuilt on the
 * locked-reference blocks. Every figure comes from an existing query, gated
 * exactly as on its own page. Where the reference shows data Chelth does not
 * hold, the same visual block carries the closest truthful signal.
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
  // Today's schedule spans each facility's own "today": its shifts can be dated
  // the day before or after the UTC date, so the role lookup covers that window.
  const dayMs = 86_400_000;
  const around = (offset: number) =>
    new Date(Date.parse(`${today}T12:00:00Z`) + offset * dayMs).toISOString().slice(0, 10);
  const [upcoming, issues, todayAttendance, exceptions, submittedTimesheets, workers, scheduled] =
    await Promise.all([
      showShifts ? listAgencyShifts(organisationId, { from: today }) : Promise.resolve([]),
      showIssues ? listAssignmentIssues(organisationId) : Promise.resolve([]),
      showAttendance ? listAgencyAttendance(organisationId, {}) : Promise.resolve([]),
      showAttendance ? listOpenExceptions(organisationId) : Promise.resolve([]),
      showTimesheets
        ? listAgencyTimesheets(organisationId, { status: "submitted" })
        : Promise.resolve([]),
      showWorkforce ? listWorkers(organisationId) : Promise.resolve([]),
      showShifts && showAttendance
        ? listAgencyShifts(organisationId, { from: around(-1), to: around(1) })
        : Promise.resolve([]),
    ]);

  const base = `/app/organisations/${organisationId}`;
  const openShifts = upcoming.filter((shift) => shift.status === "open");
  const facilityRequests = upcoming.filter((shift) => shift.source === "facility");
  const notFullyStaffed = openShifts.filter((shift) => shift.fillState !== "filled").length;
  const facilitiesWithOpen = new Set(openShifts.map((shift) => shift.facilityId)).size;
  // Assigned but not yet accepted by the worker, on upcoming open shifts.
  const unaccepted = (shift: AgencyShiftSummary) =>
    Math.max(shift.activeCount - shift.acceptedCount, 0);
  const pending = openShifts.reduce((total, shift) => total + unaccepted(shift), 0);
  const pendingSoon = openShifts
    .filter((shift) => startsWithin(shift, 24))
    .reduce((total, shift) => total + unaccepted(shift), 0);
  const urgentIssues = issues.filter((issue) => issue.severity === "urgent").length;
  const awaitingOpening = facilityRequests.filter((shift) => shift.status === "submitted").length;
  const needsReview = todayAttendance.filter((row) => row.needsReview).length;
  const disciplineByShift = new Map(scheduled.map((shift) => [shift.id, shift.disciplineName]));
  const staffing = [
    { label: "Requested", count: awaitingOpening },
    ...(["unfilled", "partially_filled", "filled"] as const).map((fillState) => ({
      label: FILL_STATE_LABELS[fillState],
      count: openShifts.filter((shift) => shift.fillState === fillState).length,
    })),
  ];
  const staffingMax = Math.max(...staffing.map((row) => row.count), 1);
  const currentWorkers = workers.filter((worker) => worker.status !== "terminated");
  const workerCounts = WORKFORCE_ROWS.map((row) => ({
    ...row,
    count: currentWorkers.filter((worker) => worker.status === row.status).length,
  }));

  type Kpi = Parameters<typeof RefKpiCard>[0] & { key: string };
  const kpis: Kpi[] = [];
  if (showShifts) {
    kpis.push({
      key: "open",
      label: "Open Shifts",
      value: openShifts.length,
      supporting: `Across ${facilitiesWithOpen} ${facilitiesWithOpen === 1 ? "facility" : "facilities"}`,
      footer: (
        <>
          {notFullyStaffed > 0 ? (
            <span className="inline-flex h-[22px] items-center rounded-md bg-danger-soft px-1.5 text-[11.5px] text-danger-soft-foreground">
              Needs coverage
            </span>
          ) : null}
          <KpiAction>View shifts</KpiAction>
        </>
      ),
      glyph: "people",
      icon: <WorkspaceNavIcon name="workforce" strokeWidth={2.4} duotone />,
      tone: "teal",
      href: `${base}/shifts?status=open&from=${today}` as Route,
    });
    kpis.push({
      key: "pending",
      label: "Pending Confirmations",
      value: pending,
      supporting: "Awaiting worker acceptance",
      footer: <KpiNote tone="warning">{pendingSoon} on shifts within 24 hours</KpiNote>,
      glyph: "calendar",
      icon: <WorkspaceNavIcon name="shifts" strokeWidth={2.4} duotone />,
      tone: "info",
      href: `${base}/shifts?status=open&from=${today}` as Route,
    });
  }
  if (showIssues) {
    kpis.push({
      key: "issues",
      label: "Assignment Issues",
      value: issues.length,
      supporting: "Need attention",
      footer: <KpiNote tone="danger">{urgentIssues} urgent</KpiNote>,
      glyph: "alert",
      icon: <WorkspaceNavIcon name="compliance" strokeWidth={2.4} duotone />,
      tone: "danger",
      href: `${base}/operations` as Route,
    });
  }
  if (showShifts) {
    kpis.push({
      key: "requests",
      label: "Facility Requests",
      value: facilityRequests.length,
      supporting: "From today onwards",
      footer: <KpiNote tone="info">{awaitingOpening} awaiting opening</KpiNote>,
      glyph: "building",
      icon: <WorkspaceNavIcon name="facilities" strokeWidth={2.4} duotone />,
      tone: "teal",
      href: `${base}/shifts?status=submitted&from=${today}` as Route,
    });
  }
  // Users without the shift signals see their own queues in the same row.
  if (kpis.length < 4 && showAttendance) {
    kpis.push({
      key: "attendance",
      label: "Attendance to Review",
      value: needsReview,
      supporting: `${exceptions.length} open exceptions today`,
      footer: <KpiAction>View attendance</KpiAction>,
      glyph: "clock",
      icon: <WorkspaceNavIcon name="attendance" strokeWidth={2.4} duotone />,
      tone: "info",
      href: `${base}/attendance` as Route,
    });
  }
  if (kpis.length < 4 && showTimesheets) {
    kpis.push({
      key: "timesheets",
      label: "Timesheets to Approve",
      value: submittedTimesheets.length,
      supporting: "Submitted by workers",
      footer: <KpiAction>View timesheets</KpiAction>,
      glyph: "document",
      icon: <WorkspaceNavIcon name="timesheets" strokeWidth={2.4} duotone />,
      tone: "teal",
      href: `${base}/timesheets?status=submitted` as Route,
    });
  }

  return (
    <div className="ref-overview flex flex-col gap-[13px]">
      <section
        aria-label="Operations summary"
        className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-[13px]"
      >
        {kpis.map(({ key, ...kpi }) => (
          <RefKpiCard key={key} {...kpi} />
        ))}
      </section>

      {/* Locked P2 grid: 790 : 442 at the 1248 px reference content width. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.787fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          {showAttendance ? (
            <RefPanel
              title="Today’s Schedule"
              titleId="today-schedule-heading"
              className="xl:min-h-[342px]"
              action={
                <RefPanelAction href={`${base}/attendance` as Route}>
                  View attendance
                </RefPanelAction>
              }
            >
              <DataTableRegion
                aria-label="Today's schedule table"
                className="mt-[9px] rounded-none border-0 bg-transparent"
              >
                <table className={cn(REF_TABLE, "min-w-[36rem] table-fixed")}>
                  {/* Locked P2 column starts (Time 17 / Role 21.6 / Facility 22.6 / Staff 20.3 / Status 18.4 %). */}
                  {showShifts ? (
                    <colgroup>
                      <col className="w-[17%]" />
                      <col className="w-[21.6%]" />
                      <col className="w-[22.6%]" />
                      <col className="w-[20.3%]" />
                      <col className="w-[18.5%]" />
                    </colgroup>
                  ) : null}
                  <thead className={REF_TEXT.tableHead}>
                    <tr>
                      <th scope="col">Time</th>
                      {showShifts ? <th scope="col">Role</th> : null}
                      <th scope="col">Facility</th>
                      <th scope="col">Staff Member</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody className={REF_TEXT.tableBody}>
                    {todayAttendance.length === 0 ? (
                      <EmptyRow colSpan={showShifts ? 5 : 4}>No one is scheduled today.</EmptyRow>
                    ) : (
                      todayAttendance.slice(0, PANEL_ROWS).map((row) => {
                        const state = deriveAttendanceState(row.clockState, row.needsReview);
                        const role = disciplineByShift.get(row.shiftId);
                        return (
                          <tr key={row.assignmentId} className="h-10">
                            <td>
                              <TimeRange times={row} />
                            </td>
                            {showShifts ? (
                              <td className="truncate whitespace-nowrap">
                                {role ? disciplineNameParts(role).name : "—"}
                              </td>
                            ) : null}
                            <td>
                              <FacilityName name={row.facilityName} />
                            </td>
                            <td className="whitespace-nowrap">
                              <span className="inline-flex items-center gap-3">
                                <InitialsAvatar name={row.workerName} />
                                {row.attendanceId ? (
                                  <Link
                                    href={`${base}/attendance/${row.attendanceId}` as Route}
                                    className="hover:text-primary hover:underline hover:underline-offset-4"
                                  >
                                    {row.workerName ?? "Worker"}
                                  </Link>
                                ) : (
                                  (row.workerName ?? "Worker")
                                )}
                              </span>
                            </td>
                            <td>
                              <RefChip className="font-normal" tone={ATTENDANCE_TONE[state]}>
                                {ATTENDANCE_STATE_LABELS[state]}
                              </RefChip>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </DataTableRegion>
            </RefPanel>
          ) : null}

          {showShifts ? (
            <RefPanel
              title="Staffing Requests"
              titleId="staffing-requests-heading"
              className="xl:min-h-[290px]"
              action={
                <RefPanelAction href={`${base}/shifts?status=submitted&from=${today}` as Route}>
                  View requests
                </RefPanelAction>
              }
            >
              <DataTableRegion
                aria-label="Staffing requests table"
                className="mt-[9px] rounded-none border-0 bg-transparent"
              >
                <table className={cn(REF_TABLE, "min-w-[40rem] table-fixed")}>
                  {/* Locked P2 column starts (13.6 / 21.8 / 14.2 / 13.8 / 16.4 / 20.3 %). */}
                  <colgroup>
                    <col className="w-[13.6%]" />
                    <col className="w-[21.8%]" />
                    <col className="w-[14.2%]" />
                    <col className="w-[13.8%]" />
                    <col className="w-[16.4%]" />
                    <col className="w-[20.2%]" />
                  </colgroup>
                  <thead className={REF_TEXT.tableHead}>
                    <tr>
                      <th scope="col">Need Date</th>
                      <th scope="col">Facility</th>
                      <th scope="col">Unit</th>
                      <th scope="col">Role</th>
                      <th scope="col">Time</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody className={REF_TEXT.tableBody}>
                    {facilityRequests.length === 0 ? (
                      <EmptyRow colSpan={6}>No facility requests coming up.</EmptyRow>
                    ) : (
                      facilityRequests.slice(0, PANEL_ROWS).map((shift) => {
                        const chip = shiftChip(shift);
                        const role = disciplineNameParts(shift.disciplineName);
                        return (
                          <tr key={shift.id} className="h-10">
                            <td className="whitespace-nowrap">{formatShiftDate(shift)}</td>
                            <td>
                              <FacilityName
                                name={shift.facilityName}
                                href={`${base}/shifts/${shift.id}` as Route}
                              />
                            </td>
                            <td className="whitespace-nowrap">{shift.locationName}</td>
                            <td className="whitespace-nowrap">
                              <span title={shift.disciplineName}>{role.code ?? role.name}</span>
                            </td>
                            <td>
                              <TimeRange times={shift} />
                            </td>
                            <td>
                              <RefChip className="font-normal" tone={chip.tone}>
                                {chip.label}
                              </RefChip>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </DataTableRegion>
            </RefPanel>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-3 xl:gap-0">
          {showWorkforce ? (
            <RefPanel
              title="Workforce Status"
              titleId="workforce-summary-heading"
              className="gap-[5px] pb-[5px] xl:min-h-[202px]"
              action={
                <RefPanelAction href={`${base}/workforce` as Route}>View workforce</RefPanelAction>
              }
            >
              {currentWorkers.length === 0 ? (
                <p className="px-[5px] py-2 text-sm text-muted-foreground">No workers yet.</p>
              ) : (
                <div className="mt-1 flex items-center gap-[31px] pr-[11px] pl-[15px]">
                  <StatusRing
                    total={currentWorkers.length}
                    active={workerCounts[0]?.count ?? 0}
                    segments={workerCounts}
                  />
                  <ul
                    aria-label="Workers by status"
                    className="flex min-w-0 flex-1 -translate-y-[9px] flex-col"
                  >
                    {workerCounts.map((row) => (
                      <li
                        key={row.status}
                        className={cn("flex h-[33px] items-center gap-3.5", REF_TEXT.legend)}
                      >
                        <span
                          aria-hidden="true"
                          className={cn("size-[13px] shrink-0 rounded-full", row.dot)}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {WORKER_STATUS_LABELS[row.status]}
                        </span>
                        <span className="font-medium text-chelth-navy tabular-nums">
                          {row.count}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </RefPanel>
          ) : null}

          {showShifts ? (
            <RefPanel
              title="Shift Coverage"
              titleId="shift-coverage-heading"
              className="gap-0 pb-1.5 xl:mt-2.5 xl:min-h-[161px]"
              action={<span className="text-[14px] text-muted-foreground">From today</span>}
            >
              <ul
                aria-label="Upcoming shifts by staffing"
                className="-mt-1 flex flex-col pr-[11px] pl-[7px]"
              >
                {staffing.map((row) => (
                  <li
                    key={row.label}
                    className={cn(
                      "grid h-[29px] grid-cols-[127px_minmax(0,1fr)_45px] items-center",
                      REF_TEXT.legend,
                    )}
                  >
                    <span className="truncate">{row.label}</span>
                    <Bar
                      value={row.count}
                      max={staffingMax}
                      id={`shift-coverage-${row.label.replace(/\s+/g, "-").toLowerCase()}`}
                    />
                    <span className="text-right text-slate-500 tabular-nums">{row.count}</span>
                  </li>
                ))}
              </ul>
            </RefPanel>
          ) : null}

          {showShifts ? (
            <RefPanel
              title="Coverage Outlook"
              titleId="coverage-outlook-heading"
              className="xl:mt-[13px] xl:min-h-[260px]"
              action={
                <span className="inline-flex h-[33px] items-center rounded-md border border-chelth-border/80 px-3 text-[13px] text-slate-600">
                  Next {OUTLOOK_DAYS} days
                </span>
              }
            >
              <CoverageOutlook shifts={upcoming} today={today} />
            </RefPanel>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Locked P2 time cell: the facility-local range as the reference shows it; the
 * zone stays available to screen readers and on hover.
 */
function TimeRange({ times }: { times: Parameters<typeof formatShiftTimeRange>[0] }) {
  const { range, zone } = formatShiftTimeRangeParts(times);
  return (
    <span title={formatShiftTimeRange(times)}>
      {range}
      <span className="sr-only"> {zone}</span>
    </span>
  );
}

/** Facility cell (locked P2): pin + name; a link when the row opens a record. */
function FacilityName({ name, href }: { name: string; href?: Route }) {
  return (
    <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
      <LocationPin className="size-3.5" />
      {href ? (
        <Link href={href} className="hover:text-primary hover:underline hover:underline-offset-4">
          {name}
        </Link>
      ) : (
        name
      )}
    </span>
  );
}

/**
 * Locked P2 ring (146 px, 17 px stroke): one arc per worker status, drawn with
 * SVG presentation attributes only (strict CSP). The centre is the share of
 * current workers whose status is Active — a ratio of the counts beside it.
 */
function StatusRing({
  total,
  active,
  segments,
}: {
  total: number;
  active: number;
  segments: { status: string; count: number; ring: string }[];
}) {
  const shown = segments.filter((segment) => segment.count > 0);
  const gap = shown.length > 1 ? 0.8 : 0;
  const lengths = shown.map((segment) => (segment.count / total) * 100);
  const share = Math.round((active / total) * 100);
  return (
    <div className="relative size-[146px] shrink-0">
      <svg
        viewBox="0 0 146 146"
        aria-hidden="true"
        focusable="false"
        className="size-full -rotate-90"
      >
        <circle
          cx="73"
          cy="73"
          r="64.5"
          fill="none"
          strokeWidth="17"
          className="stroke-surface-muted"
        />
        {shown.map((segment, index) => {
          const length = Math.max((lengths[index] ?? 0) - gap, 0);
          const start = lengths.slice(0, index).reduce((sum, value) => sum + value, 0);
          return (
            <circle
              key={segment.status}
              cx="73"
              cy="73"
              r="64.5"
              fill="none"
              strokeWidth="17"
              pathLength={100}
              strokeDasharray={`${length} ${100 - length}`}
              strokeDashoffset={-start}
              className={segment.ring}
            />
          );
        })}
      </svg>
      <p className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-display text-[25px] leading-[30px] font-bold text-chelth-navy tabular-nums">
          {share}%
        </span>
        <span className="text-[14px] leading-[17px] text-muted-foreground">
          Workforce
          <br />
          active
          <span className="sr-only">
            {" "}
            ({active} of {total} workers)
          </span>
        </span>
      </p>
    </div>
  );
}

/**
 * Locked P2 bar: 14 px track, 4 px radius, a Teal → Teal/Mint gradient fill as
 * in the reference. SVG attributes only (no inline styles).
 */
function Bar({ value, max, id }: { value: number; max: number; id: string }) {
  const width = max > 0 ? Math.round((value / max) * 1000) / 10 : 0;
  return (
    <svg width="100%" height="14" aria-hidden="true" focusable="false" className="block">
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#009c84" />
          <stop offset="1" stopColor="#2acca8" />
        </linearGradient>
      </defs>
      <rect width="100%" height="14" rx="4" className="fill-[#e6eef3]" />
      {width > 0 ? <rect width={`${width}%`} height="14" rx="4" fill={`url(#${id})`} /> : null}
    </svg>
  );
}

/**
 * Coverage Outlook (in the reference "Coverage Activity" slot): the next 14
 * days of real upcoming work — filled and still-open places per day (bars)
 * and facility requests per day (line). Forward-looking only: Chelth keeps no
 * historical series, so none is drawn.
 */
function CoverageOutlook({ shifts, today }: { shifts: AgencyShiftSummary[]; today: string }) {
  const start = Date.parse(`${today}T12:00:00Z`);
  const days = Array.from({ length: OUTLOOK_DAYS }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
  const byDay = days.map((day) => {
    const onDay = shifts.filter((shift) => localDate(shift.startAt, shift.timezone) === day);
    const open = onDay.filter((shift) => shift.status === "open");
    return {
      day,
      filled: open.reduce(
        (total, shift) => total + Math.min(shift.activeCount, shift.requestedHeadcount),
        0,
      ),
      open: open.reduce(
        (total, shift) => total + Math.max(shift.requestedHeadcount - shift.activeCount, 0),
        0,
      ),
      requests: onDay.filter((shift) => shift.source === "facility").length,
    };
  });
  const peak = Math.max(...byDay.map((d) => Math.max(d.filled + d.open, d.requests)), 1);
  const scaleMax = Math.max(4, Math.ceil(peak / 4) * 4);
  const ticks = [0, 1, 2, 3, 4].map((step) => (scaleMax / 4) * step);
  // Locked P2 chart geometry (panel-relative): top tick 31 px into the figure,
  // a 122 px plot, axis labels 18 px under it; drawn 1:1 in the 412 px column.
  const width = 412;
  const top = 31;
  const plot = 122;
  const height = top + plot;
  const left = 26;
  const slot = (width - left - 4) / OUTLOOK_DAYS;
  const y = (value: number) => top + plot - (value / scaleMax) * plot;
  const totals = byDay.reduce(
    (sum, d) => ({
      filled: sum.filled + d.filled,
      open: sum.open + d.open,
      requests: sum.requests + d.requests,
    }),
    { filled: 0, open: 0, requests: 0 },
  );
  const label = (day: string) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
      new Date(`${day}T12:00:00Z`),
    );
  const cx = (index: number) => left + slot * index + slot / 2;
  const line = byDay
    .map((d, index) => `${index === 0 ? "M" : "L"}${cx(index)} ${y(d.requests)}`)
    .join(" ");

  return (
    <figure className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${width} ${height + 25}`}
        className="h-auto w-full"
        role="img"
        aria-labelledby="coverage-outlook-summary"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              x2={width}
              y1={y(tick)}
              y2={y(tick)}
              strokeWidth="1"
              className="stroke-[#e3ebf1]"
            />
            <text
              x={left - 8}
              y={y(tick) + 4}
              textAnchor="end"
              className="fill-slate-600 text-[11px]"
            >
              {tick}
            </text>
          </g>
        ))}
        {byDay.map((d, index) => {
          const x = left + slot * index + slot * 0.2;
          const w = slot * 0.6;
          return (
            <g key={d.day}>
              {d.filled > 0 ? (
                <rect
                  x={x}
                  y={y(d.filled)}
                  width={w}
                  height={y(0) - y(d.filled)}
                  className="fill-[#00635f]"
                />
              ) : null}
              {d.open > 0 ? (
                <rect
                  x={x}
                  y={y(d.filled + d.open)}
                  width={w}
                  height={y(d.filled) - y(d.filled + d.open)}
                  className="fill-[#8ee4cf]"
                />
              ) : null}
              {index % 2 === 0 ? (
                <text
                  x={cx(index)}
                  y={height + 18}
                  textAnchor="middle"
                  className="fill-slate-600 text-[11px]"
                >
                  {label(d.day)}
                </text>
              ) : null}
            </g>
          );
        })}
        {/* Locked P2 axes: a left and a bottom rule. */}
        <line
          x1={left}
          x2={left}
          y1={top - 4}
          y2={y(0)}
          strokeWidth="1"
          className="stroke-[#c9d5de]"
        />
        <line
          x1={left}
          x2={width}
          y1={y(0)}
          y2={y(0)}
          strokeWidth="1"
          className="stroke-[#c9d5de]"
        />
        <path
          d={line}
          fill="none"
          strokeWidth="2.5"
          strokeLinejoin="round"
          className="stroke-info-indicator"
        />
        {byDay.map((d, index) => (
          <circle
            key={d.day}
            cx={cx(index)}
            cy={y(d.requests)}
            r="3.6"
            strokeWidth="2.2"
            className="fill-surface stroke-info-indicator"
          />
        ))}
      </svg>
      <figcaption id="coverage-outlook-summary" className="sr-only">
        Next {OUTLOOK_DAYS} days: {totals.filled} filled places, {totals.open} open places and{" "}
        {totals.requests} facility requests.
      </figcaption>
      <ul
        aria-hidden="true"
        className="flex flex-wrap items-center gap-x-6 gap-y-1 px-1 text-[14px] leading-5 text-slate-600"
      >
        <li className="inline-flex items-center gap-2">
          <span className="size-3 rounded-full bg-[#00635f]" />
          Filled places
        </li>
        <li className="inline-flex items-center gap-2">
          <span className="size-3 rounded-full bg-[#8ee4cf]" />
          Open places
        </li>
        <li className="inline-flex items-center gap-2">
          <span className="relative h-0.5 w-6 rounded bg-info-indicator">
            <span className="absolute top-1/2 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-info-indicator bg-surface" />
          </span>
          Facility requests
        </li>
      </ul>
    </figure>
  );
}

/** Table body row when a panel table has no rows (the header band stays, as in P2). */
function EmptyRow({ colSpan, children }: { colSpan: number; children: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="h-10 text-sm text-muted-foreground">
        {/* Phones: pinned to the visible edge of the scrolling table so it never clips. */}
        <p className="sticky left-3 max-w-[calc(100vw-7rem)] sm:static sm:max-w-none sm:text-center">
          {children}
        </p>
      </td>
    </tr>
  );
}
