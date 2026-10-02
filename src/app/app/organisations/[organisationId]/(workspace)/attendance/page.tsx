import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AttendanceSettingsForm,
  AttendanceStateBadge,
  attendanceRangeSchema,
  CorrectionReviewForms,
  getAttendanceRules,
  listAgencyAttendance,
  listOpenExceptions,
  listPendingCorrections,
  RetentionForm,
  reviewExceptionAction,
} from "@/features/attendance";
import { loadOrganisationPage, requireCapabilityOrNotFound } from "@/features/organisations";
import { getTimesheetWeekStart, WeekStartForm } from "@/features/timesheets";
import { CAPABILITIES } from "@/lib/authz";
import {
  ATTENDANCE_EXCEPTION_LABELS,
  CORRECTION_REASON_LABELS,
  describeCorrectionTarget,
  formatLocalClockTime,
  GEOFENCE_RESULT_LABELS,
} from "@/lib/domain/attendance";
import { formatShiftDate, formatShiftTimeRange, localDate } from "@/lib/domain/shifts";

export const metadata: Metadata = { title: "Attendance" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

/**
 * Attendance operations: who is scheduled in the chosen window and what needs
 * attention first. No derived metrics or charts.
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
  const [rules, weekStartsOn] =
    can(CAPABILITIES.ATTENDANCE_MANAGE_SETTINGS) === "granted"
      ? await Promise.all([
          getAttendanceRules(organisationId),
          getTimesheetWeekStart(organisationId),
        ])
      : [null, 1];
  const recordHref = (attendanceId: string) =>
    `/app/organisations/${organisationId}/attendance/${attendanceId}` as const;
  const byAssignment = new Map(rows.map((row) => [row.assignmentId, row]));

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          {organisation.name}
        </Link>
        <h1 className="text-2xl font-semibold">Attendance</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Clock-ins and clock-outs for accepted assignments. Records needing review are listed
          first. Times are shown in each facility&apos;s timezone.
        </p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="attendance-from">From (empty: today at each facility)</Label>
          <Input id="attendance-from" name="from" type="date" defaultValue={from ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="attendance-to">To (up to 7 days)</Label>
          <Input id="attendance-to" name="to" type="date" defaultValue={to ?? ""} />
        </div>
        <Button type="submit" variant="outline">
          Show
        </Button>
      </form>

      <section aria-labelledby="attendance-list-heading" className="flex flex-col gap-3">
        <h2 id="attendance-list-heading" className="text-lg font-semibold">
          Scheduled workers
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accepted assignments in this window.</p>
        ) : (
          <div
            role="region"
            aria-label="Scheduled workers table"
            tabIndex={0}
            className="overflow-x-auto rounded-lg border border-border bg-surface"
          >
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Worker
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Shift
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Clock in
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Clock out
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Needs attention
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.assignmentId}
                    className="border-b border-border align-top last:border-0"
                  >
                    <td className="px-3 py-2 font-medium">
                      {row.attendanceId ? (
                        <Link
                          href={recordHref(row.attendanceId)}
                          className="text-primary underline underline-offset-4"
                        >
                          {row.workerName ?? "Worker"}
                        </Link>
                      ) : (
                        (row.workerName ?? "Worker")
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/app/organisations/${organisationId}/shifts/${row.shiftId}`}
                        className="text-primary underline underline-offset-4"
                      >
                        {row.facilityName}
                      </Link>
                      <div className="text-muted-foreground">
                        {formatShiftDate(row)} · {formatShiftTimeRange(row)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <AttendanceStateBadge
                        clockState={row.clockState}
                        needsReview={row.needsReview}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {formatLocalClockTime(row.clockInAt, row.timezone)}
                      {row.clockInLocation && row.clockInLocation !== "not_required" ? (
                        <div className="text-xs text-muted-foreground">
                          {GEOFENCE_RESULT_LABELS[row.clockInLocation]}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {formatLocalClockTime(row.clockOutAt, row.timezone)}
                      {row.clockOutLocation && row.clockOutLocation !== "not_required" ? (
                        <div className="text-xs text-muted-foreground">
                          {GEOFENCE_RESULT_LABELS[row.clockOutLocation]}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {row.openExceptionTypes.map((type) => (
                          <Badge key={type} tone="warning">
                            {ATTENDANCE_EXCEPTION_LABELS[type]}
                          </Badge>
                        ))}
                        {row.pendingCorrections > 0 ? (
                          <Badge tone="info">Correction pending</Badge>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="corrections-heading" className="flex flex-col gap-3">
        <h2 id="corrections-heading" className="text-lg font-semibold">
          Correction requests
        </h2>
        {corrections.length === 0 ? (
          <p className="text-sm text-muted-foreground">No correction requests waiting.</p>
        ) : (
          <ul aria-label="Correction requests" className="flex flex-col gap-3">
            {corrections.map((correction) => {
              const row = byAssignment.get(correction.assignmentId);
              const worker = row?.workerName ?? "Worker";
              return (
                <li
                  key={correction.id}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm"
                >
                  <p>
                    <span className="font-medium">{worker}</span> asks to set the{" "}
                    {describeCorrectionTarget(correction.eventType, correction.segment)} to{" "}
                    <span className="font-medium">
                      {formatLocalClockTime(correction.requestedTime, row?.timezone ?? "UTC")}
                    </span>
                    {row ? ` (${row.facilityName}, ${formatShiftDate(row)})` : ""} ·{" "}
                    {CORRECTION_REASON_LABELS[correction.reason]}
                  </p>
                  {correction.note ? (
                    <p className="text-muted-foreground">“{correction.note}”</p>
                  ) : null}
                  {canReview && row ? (
                    <CorrectionReviewForms
                      organisationId={organisationId}
                      correctionId={correction.id}
                      workerName={worker}
                      timezone={row.timezone}
                      defaultDate={localDate(correction.requestedTime, row.timezone)}
                    />
                  ) : null}
                  <Link
                    href={recordHref(correction.attendanceId)}
                    className="w-fit text-xs text-primary underline underline-offset-4"
                  >
                    Open attendance record
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="exceptions-heading" className="flex flex-col gap-3">
        <h2 id="exceptions-heading" className="text-lg font-semibold">
          Open exceptions
        </h2>
        {exceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open attendance exceptions.</p>
        ) : (
          <ul aria-label="Open attendance exceptions" className="flex flex-col gap-2">
            {exceptions.map((exception) => {
              const row = byAssignment.get(exception.assignmentId);
              return (
                <li
                  key={exception.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={exception.severity === "urgent" ? "danger" : "warning"}>
                      {ATTENDANCE_EXCEPTION_LABELS[exception.type]}
                    </Badge>
                    {row
                      ? `${row.workerName ?? "Worker"} · ${row.facilityName} · ${formatShiftDate(row)}`
                      : "Outside the selected window"}
                  </span>
                  {canReview && exception.type !== "manual_correction_requested" ? (
                    <span className="flex gap-2">
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
      </section>

      {rules ? (
        <section aria-labelledby="rules-heading" className="flex flex-col gap-3">
          <h2 id="rules-heading" className="text-lg font-semibold">
            Attendance rules
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {rules.isDefault ? "Chelth defaults are in use. " : ""}Location checks are configured
            per facility location.
          </p>
          <AttendanceSettingsForm organisationId={organisationId} rules={rules} />
          <h3 className="pt-2 text-base font-semibold">Location evidence retention</h3>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Raw coordinates from clock actions are purged after this period unless a legal hold
            applies. Confirm the period with your legal adviser before production use.
          </p>
          <RetentionForm organisationId={organisationId} retentionDays={rules.retentionDays} />
          <h3 className="pt-2 text-base font-semibold">Timesheet week</h3>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Timesheets are weekly. The week start is fixed once the first timesheet exists.
          </p>
          <WeekStartForm organisationId={organisationId} weekStartsOn={weekStartsOn} />
        </section>
      ) : null}
    </>
  );
}
