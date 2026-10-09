import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import {
  InitialsAvatar,
  KpiNote,
  REF_TABLE,
  REF_TEXT,
  RefChip,
  RefKpiCard,
  RefPanel,
} from "@/components/reference/locked-reference";
import { DataTableRegion } from "@/components/ui/data-table";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  attendanceRangeSchema,
  CorrectionReviewForms,
  listAgencyAttendance,
  listOpenExceptions,
  listPendingCorrections,
  reviewExceptionAction,
} from "@/features/attendance";
import { loadOrganisationPage, requireCapabilityOrNotFound } from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";
import {
  ATTENDANCE_EXCEPTION_LABELS,
  ATTENDANCE_STATE_LABELS,
  type AttendanceExceptionType,
  CORRECTION_REASON_LABELS,
  deriveAttendanceState,
  describeCorrectionTarget,
  formatLocalClockTime,
  GEOFENCE_RESULT_LABELS,
  type GeofenceResult,
} from "@/lib/domain/attendance";
import {
  formatShiftDate,
  formatShiftTimeRange,
  formatShiftTimeRangeParts,
  localDate,
} from "@/lib/domain/shifts";
import { cn } from "@/lib/utils/cn";

import { AttendanceDetailsPanel } from "./_components/attendance-details-panel";
import { ATTENDANCE_TONE, GEOFENCE_TONE } from "./_components/attendance-tones";

const LOCATION_ISSUES: readonly AttendanceExceptionType[] = [
  "outside_geofence",
  "poor_location_accuracy",
  "location_unavailable",
];
/** Location-check results shown in the verification ring, in legend order. */
const VERIFICATION_ROWS: { result: GeofenceResult; ring: string; dot: string }[] = [
  { result: "inside", ring: "stroke-success-indicator", dot: "bg-success-indicator" },
  { result: "low_accuracy", ring: "stroke-warning-indicator", dot: "bg-warning-indicator" },
  { result: "unavailable", ring: "stroke-info-indicator", dot: "bg-info-indicator" },
  { result: "outside", ring: "stroke-danger-indicator", dot: "bg-danger-indicator" },
];

export const metadata: Metadata = { title: "Attendance" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

/**
 * Attendance operations (locked Attendance reference): who is scheduled in the
 * chosen window and what needs attention first. Every figure is a count of
 * loaded records; location checks show derived results only, never coordinates.
 */
export default async function AttendancePage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/attendance">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.ATTENDANCE_VIEW);
  const { organisationId, organisation, can } = context;
  if (organisation.type !== "agency") notFound();

  const raw = await searchParams;
  const range = attendanceRangeSchema.parse({ from: first(raw.from), to: first(raw.to) });
  // No dates chosen: "today" in each facility's own timezone (never the UTC date).
  const from = range.from;
  const to = range.to ?? from;
  const canReview = can(CAPABILITIES.ATTENDANCE_REVIEW) === "granted";
  const [rows, corrections, exceptions] = await Promise.all([
    listAgencyAttendance(organisationId, from ? { from, to } : {}),
    listPendingCorrections(organisationId),
    listOpenExceptions(organisationId),
  ]);
  // Attendance rules live in Settings → Attendance & Geofencing (P0-E8-S9H).
  const canManageSettings = can(CAPABILITIES.ATTENDANCE_MANAGE_SETTINGS) === "granted";
  const recordHref = (attendanceId: string) =>
    `/app/organisations/${organisationId}/attendance/${attendanceId}` as const;
  const byAssignment = new Map(rows.map((row) => [row.assignmentId, row]));

  const base = `/app/organisations/${organisationId}/attendance` as const;
  const shiftHref = (shiftId: string) =>
    `/app/organisations/${organisationId}/shifts/${shiftId}` as Route;
  const needsReviewCount = rows.filter((row) => row.needsReview).length;
  const clockedInNow = rows.filter(
    (row) => row.clockState === "clocked_in" || row.clockState === "on_break",
  );
  const completed = rows.filter((row) => row.clockState === "clocked_out").length;
  const windowAssignments = new Set(rows.map((row) => row.assignmentId));
  const windowExceptions = exceptions.filter((exception) =>
    windowAssignments.has(exception.assignmentId),
  );
  const lateCount = windowExceptions.filter((e) => e.type === "late_clock_in").length;
  const missedCount = windowExceptions.filter((e) => e.type === "missed_clock_in").length;
  const locationExceptions = windowExceptions.filter((e) => LOCATION_ISSUES.includes(e.type));
  const outsideCount = locationExceptions.filter((e) => e.type === "outside_geofence").length;
  const urgentExceptions = exceptions.filter((exception) => exception.severity === "urgent").length;
  const exceptionsOf = (assignmentId: string) =>
    exceptions.filter((exception) => exception.assignmentId === assignmentId);
  const checked = rows.flatMap((row) =>
    row.clockInLocation && row.clockInLocation !== "not_required" ? [row.clockInLocation] : [],
  );
  const verification = VERIFICATION_ROWS.map((entry) => ({
    ...entry,
    count: checked.filter((result) => result === entry.result).length,
  }));
  const insideShare =
    checked.length > 0 ? Math.round(((verification[0]?.count ?? 0) / checked.length) * 100) : null;
  const facilitiesClockedIn = new Set(clockedInNow.map((row) => row.facilityName)).size;
  const windowLabel = from
    ? `${from}${to && to !== from ? ` – ${to}` : ""}`
    : "Today at each facility";

  return (
    <div className="chelth-locked flex flex-col gap-[13px]">
      <PageHeader
        variant="reference"
        className="xl:mb-1"
        title="Attendance"
        description={
          <p>Verify clock-ins, resolve exceptions and track attendance across active shifts.</p>
        }
        primaryAction={
          // Locked header control: the attendance window (real date range filter).
          <form
            key={`${from ?? ""}_${to ?? ""}`}
            aria-label="Attendance window"
            method="get"
            className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
          >
            <span className="flex h-[46px] w-full items-center gap-2 rounded-lg border border-chelth-border bg-white/90 px-3 text-chelth-navy shadow-[0_1px_2px_rgba(13,47,66,0.04)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring sm:h-11 sm:w-auto">
              <WorkspaceNavIcon name="shifts" strokeWidth={2.1} className="size-[18px]" />
              <Label htmlFor="attendance-from" className="sr-only">
                From (empty: today at each facility)
              </Label>
              <input
                id="attendance-from"
                name="from"
                type="date"
                defaultValue={from ?? ""}
                className="h-full w-0 min-w-0 flex-1 bg-transparent text-base font-medium outline-none sm:w-auto sm:flex-none sm:text-[14px]"
              />
              <span aria-hidden="true" className="text-muted-foreground">
                –
              </span>
              <Label htmlFor="attendance-to" className="sr-only">
                To (up to 7 days)
              </Label>
              <input
                id="attendance-to"
                name="to"
                type="date"
                defaultValue={to ?? ""}
                className="h-full w-0 min-w-0 flex-1 bg-transparent text-base font-medium outline-none sm:w-auto sm:flex-none sm:text-[14px]"
              />
            </span>
            <button
              type="submit"
              className="inline-flex h-11 items-center rounded-lg border border-chelth-border bg-white/90 px-4 text-[14px] font-semibold text-chelth-navy hover:bg-surface-muted"
            >
              Show
            </button>
            <Link
              href={base as Route}
              className="inline-flex min-h-11 items-center px-1 text-[13.5px] font-semibold text-primary underline underline-offset-4"
            >
              Today
            </Link>
          </form>
        }
      />

      {/* Real counts the page already loads; each card jumps to its section. */}
      <section
        aria-label="Attendance summary"
        className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-[13px]"
      >
        <RefKpiCard
          label="Clocked In Now"
          value={clockedInNow.length}
          supporting={`Across ${facilitiesClockedIn} ${facilitiesClockedIn === 1 ? "facility" : "facilities"}`}
          footer={<KpiNote tone="success">{windowLabel}</KpiNote>}
          glyph="people"
          icon={<WorkspaceNavIcon name="workforce" strokeWidth={2.25} duotone />}
          tone="teal"
          href={`${base}#scheduled-workers` as Route}
        />
        <RefKpiCard
          label="Needs Review"
          value={needsReviewCount}
          supporting="Late, missed or flagged"
          footer={
            <KpiNote tone="warning">
              {lateCount} late · {missedCount} missed
            </KpiNote>
          }
          glyph="clock"
          icon={<WorkspaceNavIcon name="attendance" strokeWidth={2.25} duotone />}
          tone="warning"
          href={`${base}#scheduled-workers` as Route}
        />
        <RefKpiCard
          label="Location Issues"
          value={locationExceptions.length}
          supporting="Require review"
          footer={
            <KpiNote tone="danger">
              {outsideCount} outside · {locationExceptions.length - outsideCount} imprecise or
              unavailable
            </KpiNote>
          }
          glyph="alert"
          icon={<WorkspaceNavIcon name="compliance" strokeWidth={2.25} duotone />}
          tone="danger"
          href={`${base}#open-exceptions` as Route}
        />
        <RefKpiCard
          label="Completed"
          value={completed}
          supporting="Shifts clocked out"
          footer={
            <KpiNote tone="info">
              {corrections.length} correction {corrections.length === 1 ? "request" : "requests"}
            </KpiNote>
          }
          glyph="document"
          icon={<WorkspaceNavIcon name="timesheets" strokeWidth={2.25} duotone />}
          tone="info"
          href={`${base}#correction-requests` as Route}
        />
      </section>

      {/* Locked two-column composition (Overview grid), docked drawer contracts it. */}
      <div className="grid gap-4 min-[1536px]:has-[dialog[open]]:pr-[407px] xl:grid-cols-[minmax(0,1.787fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div id="scheduled-workers" className="scroll-mt-24">
            <RefPanel
              title="Scheduled Workers"
              titleId="attendance-list-heading"
              action={<span className="text-[13.5px] text-muted-foreground">{windowLabel}</span>}
            >
              {rows.length === 0 ? (
                <AttendanceEmpty
                  title="No accepted assignments in this window."
                  note="Choose another window, or check Shifts for assignments still waiting for acceptance."
                />
              ) : (
                <DataTableRegion
                  aria-label="Scheduled workers table"
                  className="mt-[9px] rounded-none border-0 bg-transparent"
                >
                  <table className={cn(REF_TABLE, "min-w-[820px] table-fixed")}>
                    <colgroup>
                      <col className="w-[13%]" />
                      <col className="w-[18%]" />
                      <col className="w-[20%]" />
                      <col className="w-[13%]" />
                      <col className="w-[18%]" />
                      <col className="w-[14%]" />
                      <col className="w-[4%]" />
                    </colgroup>
                    <thead className={REF_TEXT.tableHead}>
                      <tr>
                        <th scope="col">Clock-in</th>
                        <th scope="col">Worker</th>
                        <th scope="col">Facility</th>
                        <th scope="col">Shift</th>
                        <th scope="col">Status</th>
                        <th scope="col">Location</th>
                        <th scope="col">
                          <span className="sr-only">Details</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className={REF_TEXT.tableBody}>
                      {rows.map((row) => {
                        const worker = row.workerName ?? "Worker";
                        const state = deriveAttendanceState(row.clockState, row.needsReview);
                        const flags = [
                          ...row.openExceptionTypes.map(
                            (type) => ATTENDANCE_EXCEPTION_LABELS[type],
                          ),
                          ...(row.pendingCorrections > 0 ? ["Correction pending"] : []),
                        ];
                        return (
                          <tr
                            key={row.assignmentId}
                            className="h-[42px] transition-colors hover:bg-surface-muted/50 has-[dialog[open]]:bg-chelth-mint-mist/70 [&:has(dialog[open])>*:first-child]:shadow-[inset_3px_0_0_var(--chelth-teal)]"
                          >
                            <td className="whitespace-nowrap">
                              {formatLocalClockTime(row.clockInAt, row.timezone)}
                            </td>
                            <td>
                              <span className="flex items-center gap-2.5">
                                <InitialsAvatar name={row.workerName} />
                                {row.attendanceId ? (
                                  <Link
                                    href={`${base}/${row.attendanceId}` as Route}
                                    className="truncate font-medium text-chelth-navy hover:text-primary hover:underline hover:underline-offset-4"
                                  >
                                    {worker}
                                  </Link>
                                ) : (
                                  <span className="truncate font-medium text-chelth-navy">
                                    {worker}
                                  </span>
                                )}
                              </span>
                            </td>
                            <td>
                              <Link
                                href={shiftHref(row.shiftId)}
                                className="block truncate hover:text-primary hover:underline hover:underline-offset-4"
                              >
                                {row.facilityName}
                              </Link>
                            </td>
                            <td className="whitespace-nowrap" title={formatShiftTimeRange(row)}>
                              {formatShiftTimeRangeParts(row).range}
                            </td>
                            <td>
                              <span className="flex flex-col items-start gap-0.5 py-1.5">
                                <RefChip tone={ATTENDANCE_TONE[state]} className="font-normal">
                                  {ATTENDANCE_STATE_LABELS[state]}
                                </RefChip>
                                {flags.length > 0 ? (
                                  <span className="text-[11.5px] leading-4 text-slate-600">
                                    {flags.join(" · ")}
                                  </span>
                                ) : null}
                              </span>
                            </td>
                            <td>
                              {row.clockInLocation && row.clockInLocation !== "not_required" ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <span
                                    aria-hidden="true"
                                    className={cn(
                                      "size-2 rounded-full",
                                      GEOFENCE_DOT[GEOFENCE_TONE[row.clockInLocation]],
                                    )}
                                  />
                                  {GEOFENCE_RESULT_LABELS[row.clockInLocation]}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="text-right">
                              <DetailDrawerTrigger
                                triggerLabel="⋮"
                                triggerClassName="justify-center px-2 text-xl font-bold text-chelth-navy no-underline sm:min-h-9"
                                triggerAccessibleLabel={`Details for ${worker}`}
                                title="Attendance Details"
                                width="profile"
                              >
                                <AttendanceDetailsPanel
                                  row={row}
                                  exceptions={exceptionsOf(row.assignmentId)}
                                  recordHref={
                                    row.attendanceId
                                      ? (`${base}/${row.attendanceId}` as Route)
                                      : null
                                  }
                                  shiftHref={shiftHref(row.shiftId)}
                                />
                              </DetailDrawerTrigger>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </DataTableRegion>
              )}
            </RefPanel>
          </div>

          <div id="correction-requests" className="scroll-mt-24">
            <RefPanel title="Correction Requests" titleId="corrections-heading">
              {corrections.length === 0 ? (
                <AttendanceEmpty
                  title="No correction requests waiting."
                  note="Corrections are append-only: the original clock events are always kept."
                />
              ) : (
                <ul
                  aria-label="Correction requests"
                  className="mt-[9px] flex flex-col divide-y divide-[rgba(18,107,103,0.12)] px-[5px]"
                >
                  {corrections.map((correction) => {
                    const row = byAssignment.get(correction.assignmentId);
                    const worker = row?.workerName ?? "Worker";
                    return (
                      <li key={correction.id} className="flex flex-col gap-2 py-3 text-[13.5px]">
                        <div className="flex items-start gap-3">
                          <InitialsAvatar name={row?.workerName ?? null} />
                          <p className="leading-5 text-slate-600">
                            <span className="font-semibold text-chelth-navy">{worker}</span> asks to
                            set the{" "}
                            {describeCorrectionTarget(correction.eventType, correction.segment)} to{" "}
                            <span className="font-semibold text-chelth-navy">
                              {formatLocalClockTime(
                                correction.requestedTime,
                                row?.timezone ?? "UTC",
                              )}
                            </span>
                            {row ? ` (${row.facilityName}, ${formatShiftDate(row)})` : ""} ·{" "}
                            {CORRECTION_REASON_LABELS[correction.reason]}
                          </p>
                        </div>
                        {correction.note ? (
                          <p className="pl-11 text-slate-600">“{correction.note}”</p>
                        ) : null}
                        {canReview && row ? (
                          <div className="pl-11">
                            <CorrectionReviewForms
                              organisationId={organisationId}
                              correctionId={correction.id}
                              workerName={worker}
                              timezone={row.timezone}
                              defaultDate={localDate(correction.requestedTime, row.timezone)}
                            />
                          </div>
                        ) : null}
                        <Link
                          href={recordHref(correction.attendanceId)}
                          className="w-fit pl-11 text-[12.5px] font-semibold text-primary underline underline-offset-4"
                        >
                          Open attendance record
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </RefPanel>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div id="open-exceptions" className="scroll-mt-24">
            <RefPanel
              title="Attendance Exceptions"
              titleId="exceptions-heading"
              action={
                urgentExceptions > 0 ? (
                  <RefChip tone="danger" className="font-semibold">
                    {urgentExceptions} urgent
                  </RefChip>
                ) : undefined
              }
            >
              {exceptions.length === 0 ? (
                <AttendanceEmpty title="No open attendance exceptions." note="All clear." />
              ) : (
                <ul
                  aria-label="Open attendance exceptions"
                  className="flex flex-col divide-y divide-[rgba(18,107,103,0.12)] px-[5px]"
                >
                  {exceptions.map((exception) => {
                    const row = byAssignment.get(exception.assignmentId);
                    return (
                      <li key={exception.id} className="flex flex-col gap-2 py-2.5 text-[13.5px]">
                        <div className="flex items-center gap-3">
                          <InitialsAvatar name={row?.workerName ?? null} />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate font-semibold text-chelth-navy">
                              {row?.workerName ?? "Worker"}
                            </span>
                            <span className="truncate text-[12px] text-slate-600">
                              {row
                                ? `${row.facilityName} · ${formatShiftDate(row)}`
                                : "Outside the selected window"}
                            </span>
                          </span>
                          <RefChip
                            tone={exception.severity === "urgent" ? "danger" : "warning"}
                            className="font-semibold"
                          >
                            {ATTENDANCE_EXCEPTION_LABELS[exception.type]}
                          </RefChip>
                        </div>
                        {canReview && exception.type !== "manual_correction_requested" ? (
                          <span className="flex flex-wrap gap-2 pl-11">
                            <InlineActionForm
                              action={reviewExceptionAction}
                              fields={{
                                organisationId,
                                exceptionId: exception.id,
                                status: "resolved",
                                resolution: "acknowledged",
                              }}
                              label="Acknowledge"
                              accessibleLabel={`Acknowledge ${ATTENDANCE_EXCEPTION_LABELS[exception.type]}`}
                            />
                            <InlineActionForm
                              action={reviewExceptionAction}
                              fields={{
                                organisationId,
                                exceptionId: exception.id,
                                status: "dismissed",
                                resolution: "not_applicable",
                              }}
                              label="Dismiss"
                              accessibleLabel={`Dismiss ${ATTENDANCE_EXCEPTION_LABELS[exception.type]}`}
                              variant="ghost"
                            />
                            {exception.type === "missed_clock_in" ? (
                              <InlineActionForm
                                action={reviewExceptionAction}
                                fields={{
                                  organisationId,
                                  exceptionId: exception.id,
                                  status: "resolved",
                                  resolution: "not_worked",
                                }}
                                label="Mark not worked"
                                accessibleLabel={`Mark not worked: ${row?.workerName ?? "worker"}`}
                                variant="ghost"
                              />
                            ) : null}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </RefPanel>
          </div>

          <RefPanel
            title="Location Verification"
            titleId="verification-heading"
            action={<span className="text-[13.5px] text-muted-foreground">Clock-ins</span>}
          >
            {checked.length === 0 ? (
              <AttendanceEmpty
                title="No location checks in this window."
                note="Results appear for locations with checks enabled."
              />
            ) : (
              <div className="flex items-center gap-6 px-[15px] py-2">
                <VerificationRing
                  share={insideShare ?? 0}
                  total={checked.length}
                  segments={verification}
                />
                <ul aria-label="Clock-in location results" className="flex min-w-0 flex-1 flex-col">
                  {verification.map((entry) => (
                    <li
                      key={entry.result}
                      className={cn("flex h-[30px] items-center gap-3", REF_TEXT.legend)}
                    >
                      <span
                        aria-hidden="true"
                        className={cn("size-[11px] shrink-0 rounded-full", entry.dot)}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {GEOFENCE_RESULT_LABELS[entry.result]}
                      </span>
                      <span className="font-medium text-chelth-navy tabular-nums">
                        {entry.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </RefPanel>
        </div>
      </div>

      {canManageSettings ? (
        <p className="text-[13.5px] text-slate-600">
          Attendance rules, location evidence retention and the timesheet week are in{" "}
          <Link
            href={`/app/organisations/${organisationId}/settings/attendance` as Route}
            className="font-semibold text-primary underline underline-offset-4"
          >
            Settings
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

const GEOFENCE_DOT: Record<string, string> = {
  success: "bg-success-indicator",
  danger: "bg-danger-indicator",
  warning: "bg-warning-indicator",
  info: "bg-info-indicator",
  neutral: "bg-neutral-indicator",
  attention: "bg-attention-indicator",
};

/** Deliberate empty state inside a reference panel. */
function AttendanceEmpty({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-center gap-3 px-[5px] py-3">
      <span
        aria-hidden="true"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-muted text-muted-foreground [&>svg]:size-[19px]"
      >
        <WorkspaceNavIcon name="attendance" strokeWidth={2} />
      </span>
      <span className="flex flex-col">
        <span className="text-[14px] leading-5 font-medium text-slate-600">{title}</span>
        <span className="text-[12.5px] leading-[18px] text-muted-foreground">{note}</span>
      </span>
    </div>
  );
}

/**
 * Locked ring (as Overview's Workforce ring): one arc per clock-in location
 * result. The centre is the share of checked clock-ins inside the site area —
 * a direct ratio of the counts beside it. SVG attributes only (strict CSP).
 */
function VerificationRing({
  share,
  total,
  segments,
}: {
  share: number;
  total: number;
  segments: { result: string; count: number; ring: string }[];
}) {
  const shown = segments.filter((segment) => segment.count > 0);
  const gap = shown.length > 1 ? 0.8 : 0;
  const lengths = shown.map((segment) => (segment.count / total) * 100);
  return (
    <div className="relative size-[132px] shrink-0">
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
              key={segment.result}
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
        <span className="font-display text-[24px] leading-7 font-bold text-chelth-navy tabular-nums">
          {share}%
        </span>
        <span className="text-[12.5px] leading-4 text-muted-foreground">
          Inside
          <br />
          site area
        </span>
      </p>
    </div>
  );
}
