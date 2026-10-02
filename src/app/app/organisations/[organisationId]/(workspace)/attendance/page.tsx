import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { KeyValueList } from "@/components/ui/key-value-list";
import { KpiFilterCard, KpiFilterGroup } from "@/components/ui/kpi-filter-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
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

  const base = `/app/organisations/${organisationId}/attendance` as const;
  const needsReviewCount = rows.filter((row) => row.needsReview).length;
  const urgentExceptions = exceptions.filter((exception) => exception.severity === "urgent").length;

  return (
    <>
      <PageHeader
        title="Attendance"
        back={
          <Link
            href={`/app/organisations/${organisationId}`}
            className="text-primary underline underline-offset-4"
          >
            {organisation.name}
          </Link>
        }
        description={
          <p>
            Clock-ins and clock-outs for accepted assignments. Records needing review are listed
            first. Times are shown in each facility&apos;s timezone.
          </p>
        }
      />

      {/* Real counts the page already loads; each card jumps to its section. */}
      <KpiFilterGroup label="Attendance summary">
        <KpiFilterCard
          label="Scheduled"
          value={rows.length}
          supporting="In this window"
          icon={<WorkspaceNavIcon name="shifts" />}
          href={`${base}#scheduled-workers` as Route}
        />
        <KpiFilterCard
          label="Needs review"
          value={needsReviewCount}
          supporting="In this window"
          icon={<WorkspaceNavIcon name="attendance" />}
          href={`${base}#scheduled-workers` as Route}
        />
        <KpiFilterCard
          label="Correction requests"
          value={corrections.length}
          supporting="Waiting for review"
          icon={<WorkspaceNavIcon name="timesheets" />}
          href={`${base}#correction-requests` as Route}
        />
        <KpiFilterCard
          label="Open exceptions"
          value={exceptions.length}
          supporting={urgentExceptions > 0 ? `${urgentExceptions} urgent` : "None urgent"}
          icon={<WorkspaceNavIcon name="compliance" />}
          href={`${base}#open-exceptions` as Route}
        />
      </KpiFilterGroup>

      <FilterBar
        label="Attendance window"
        submitLabel="Show"
        resetHref={base as Route}
        resetLabel="Today"
      >
        <FilterField label="From (empty: today at each facility)" htmlFor="attendance-from">
          <Input id="attendance-from" name="from" type="date" defaultValue={from ?? ""} />
        </FilterField>
        <FilterField label="To (up to 7 days)" htmlFor="attendance-to">
          <Input id="attendance-to" name="to" type="date" defaultValue={to ?? ""} />
        </FilterField>
      </FilterBar>

      <section
        id="scheduled-workers"
        aria-labelledby="attendance-list-heading"
        className="flex scroll-mt-24 flex-col gap-3"
      >
        <h2 id="attendance-list-heading" className="font-display text-lg font-semibold">
          Scheduled workers
        </h2>
        {rows.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No accepted assignments in this window."
            description="Choose another window, or check Shifts for assignments still waiting for acceptance."
          />
        ) : (
          <DataTableRegion aria-label="Scheduled workers table">
            <DataTable className="min-w-[760px]">
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Worker</DataTableHeaderCell>
                  <DataTableHeaderCell>Shift</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Clock in</DataTableHeaderCell>
                  <DataTableHeaderCell>Clock out</DataTableHeaderCell>
                  <DataTableHeaderCell>Needs attention</DataTableHeaderCell>
                  <DataTableHeaderCell>
                    <span className="sr-only">Details</span>
                  </DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                {rows.map((row) => {
                  const worker = row.workerName ?? "Worker";
                  const attention = (
                    <div className="flex flex-wrap gap-1">
                      {row.openExceptionTypes.map((type) => (
                        <StatusChip key={type} tone="attention">
                          {ATTENDANCE_EXCEPTION_LABELS[type]}
                        </StatusChip>
                      ))}
                      {row.pendingCorrections > 0 ? (
                        <StatusChip tone="info">Correction pending</StatusChip>
                      ) : null}
                    </div>
                  );
                  const clockIn = (
                    <>
                      {formatLocalClockTime(row.clockInAt, row.timezone)}
                      {row.clockInLocation && row.clockInLocation !== "not_required" ? (
                        <div className="text-xs text-muted-foreground">
                          {GEOFENCE_RESULT_LABELS[row.clockInLocation]}
                        </div>
                      ) : null}
                    </>
                  );
                  const clockOut = (
                    <>
                      {formatLocalClockTime(row.clockOutAt, row.timezone)}
                      {row.clockOutLocation && row.clockOutLocation !== "not_required" ? (
                        <div className="text-xs text-muted-foreground">
                          {GEOFENCE_RESULT_LABELS[row.clockOutLocation]}
                        </div>
                      ) : null}
                    </>
                  );
                  return (
                    <DataTableRow key={row.assignmentId}>
                      <DataTableCell className="font-medium">
                        {row.attendanceId ? (
                          <Link
                            href={recordHref(row.attendanceId)}
                            className="text-primary underline underline-offset-4"
                          >
                            {worker}
                          </Link>
                        ) : (
                          worker
                        )}
                      </DataTableCell>
                      <DataTableCell>
                        <Link
                          href={`/app/organisations/${organisationId}/shifts/${row.shiftId}`}
                          className="text-primary underline underline-offset-4"
                        >
                          {row.facilityName}
                        </Link>
                        <div className="text-muted-foreground">
                          {formatShiftDate(row)} · {formatShiftTimeRange(row)}
                        </div>
                      </DataTableCell>
                      <DataTableCell>
                        <AttendanceStateBadge
                          clockState={row.clockState}
                          needsReview={row.needsReview}
                        />
                      </DataTableCell>
                      <DataTableCell>{clockIn}</DataTableCell>
                      <DataTableCell>{clockOut}</DataTableCell>
                      <DataTableCell>{attention}</DataTableCell>
                      <DataTableCell>
                        <DetailDrawerTrigger
                          triggerLabel="Details"
                          triggerAccessibleLabel={`Details for ${worker}`}
                          title={worker}
                          description={`${row.facilityName} · ${formatShiftDate(row)}`}
                          footer={
                            <>
                              {row.attendanceId ? (
                                <Link
                                  href={recordHref(row.attendanceId)}
                                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
                                >
                                  Open attendance record
                                </Link>
                              ) : null}
                              <Link
                                href={`/app/organisations/${organisationId}/shifts/${row.shiftId}`}
                                className="inline-flex min-h-11 items-center justify-center rounded-md border border-input-border bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-muted"
                              >
                                Open shift
                              </Link>
                            </>
                          }
                        >
                          <KeyValueList
                            items={[
                              {
                                label: "Status",
                                value: (
                                  <AttendanceStateBadge
                                    clockState={row.clockState}
                                    needsReview={row.needsReview}
                                  />
                                ),
                              },
                              { label: "Facility", value: row.facilityName },
                              { label: "Location", value: row.locationName },
                              {
                                label: "Shift",
                                value: `${formatShiftDate(row)} · ${formatShiftTimeRange(row)}`,
                              },
                              { label: "Timezone", value: row.timezone },
                              { label: "Clock in", value: clockIn },
                              { label: "Clock out", value: clockOut },
                              {
                                label: "Needs attention",
                                value:
                                  row.openExceptionTypes.length > 0 || row.pendingCorrections > 0
                                    ? attention
                                    : "Nothing open",
                              },
                            ]}
                          />
                        </DetailDrawerTrigger>
                      </DataTableCell>
                    </DataTableRow>
                  );
                })}
              </tbody>
            </DataTable>
          </DataTableRegion>
        )}
      </section>

      <section
        id="correction-requests"
        aria-labelledby="corrections-heading"
        className="flex scroll-mt-24 flex-col gap-3"
      >
        <h2 id="corrections-heading" className="font-display text-lg font-semibold">
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

      <section
        id="open-exceptions"
        aria-labelledby="exceptions-heading"
        className="flex scroll-mt-24 flex-col gap-3"
      >
        <h2 id="exceptions-heading" className="font-display text-lg font-semibold">
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
                    <StatusChip tone={exception.severity === "urgent" ? "danger" : "attention"}>
                      {ATTENDANCE_EXCEPTION_LABELS[exception.type]}
                    </StatusChip>
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
          <h2 id="rules-heading" className="font-display text-lg font-semibold">
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
