import type { Metadata } from "next";
import Link from "next/link";

import { Panel } from "@/components/ui/panel";
import { notFound } from "next/navigation";
import { z } from "zod";

import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { InlineActionForm } from "@/components/forms/inline-action-form";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import {
  AdjustAttendanceForm,
  type AttendanceHistoryItem,
  AttendanceStateBadge,
  getAttendanceRecord,
  listAgencyAttendance,
  listAttendanceExceptions,
  listAttendanceHistory,
  reviewExceptionAction,
} from "@/features/attendance";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";
import {
  ADJUSTMENT_REASON_LABELS,
  ATTENDANCE_EVENT_LABELS,
  ATTENDANCE_EXCEPTION_LABELS,
  ATTENDANCE_EXCEPTION_STATUS_LABELS,
  CORRECTION_ORIGIN_LABELS,
  CORRECTION_REASON_LABELS,
  CORRECTION_RESOLUTION_LABELS,
  CORRECTION_STATUS_LABELS,
  describeCorrectionTarget,
  EXCEPTION_RESOLUTION_LABELS,
  GEOFENCE_RESULT_LABELS,
} from "@/lib/domain/attendance";
import { formatShiftDate, formatShiftTimeRange, localDate } from "@/lib/domain/shifts";
import type { Json } from "@/types/database.types";

export const metadata: Metadata = { title: "Attendance record" };

const idSchema = z.uuid();

function text(value: Json | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function label(labels: Record<string, string>, value: Json | undefined): string | null {
  const key = text(value);
  return key ? (labels[key] ?? key) : null;
}

function dateTime(instant: string | null, timezone: string): string {
  if (!instant) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(instant));
}

/** One history line: what happened, when, and (agency) who. Never coordinates. */
function describe(item: AttendanceHistoryItem, timezone: string) {
  const d = item.detail;
  if (item.kind === "event") {
    const name =
      (ATTENDANCE_EVENT_LABELS as Record<string, string>)[item.eventType] ?? item.eventType;
    const isBreak = item.eventType.includes("break");
    const lines = [
      d.source === "approved_correction"
        ? "Appended from an approved correction"
        : "Recorded at server time from the worker's device",
    ];
    const result = label(GEOFENCE_RESULT_LABELS, d.geofence_result);
    if (result && d.geofence_result !== "not_required") lines.push(`Location: ${result}`);
    return {
      what: `${name}${isBreak && item.segment ? ` (break ${item.segment})` : ""}`,
      when: dateTime(item.at, timezone),
      lines,
      who: text(d.actor_name),
    };
  }
  if (item.kind === "correction") {
    const origin = label(CORRECTION_ORIGIN_LABELS, d.origin) ?? "Correction";
    const lines = [
      `Asked for ${describeCorrectionTarget(item.eventType, item.segment ?? 1)}: ${dateTime(text(d.requested_time), timezone)}`,
    ];
    const reason = label(CORRECTION_REASON_LABELS, d.reason);
    if (reason && d.origin === "worker_request") lines.push(`Reason: ${reason}`);
    const workerNote = text(d.worker_note);
    if (workerNote) lines.push(`Worker note: “${workerNote}”`);
    const status = label(CORRECTION_STATUS_LABELS, d.status);
    const resolution = label(CORRECTION_RESOLUTION_LABELS, d.resolution);
    if (status) lines.push(`Decision: ${status}${resolution ? ` — ${resolution}` : ""}`);
    if (d.resolution === "approved_with_adjustment") {
      lines.push(`Approved time: ${dateTime(text(d.approved_time), timezone)}`);
      const adjustment = label(ADJUSTMENT_REASON_LABELS, d.adjustment_reason);
      if (adjustment) lines.push(`Adjustment reason: ${adjustment}`);
    }
    const reviewerNote = text(d.reviewer_note);
    if (reviewerNote) lines.push(`Reviewer note: “${reviewerNote}”`);
    const reviewer = text(d.reviewer_name);
    return {
      what: origin,
      when: dateTime(item.at, timezone),
      lines,
      who: [text(d.requested_by_name), reviewer ? `reviewed by ${reviewer}` : null]
        .filter(Boolean)
        .join(", "),
    };
  }
  const status = label(ATTENDANCE_EXCEPTION_STATUS_LABELS, d.status);
  const resolution = label(EXCEPTION_RESOLUTION_LABELS, d.resolution);
  return {
    what: `Exception: ${(ATTENDANCE_EXCEPTION_LABELS as Record<string, string>)[item.eventType] ?? item.eventType}`,
    when: dateTime(item.at, timezone),
    lines: [
      `${status ?? ""}${resolution ? ` — ${resolution}` : ""}`,
      ...(text(d.resolved_at) ? [`Closed ${dateTime(text(d.resolved_at), timezone)}`] : []),
    ],
    who: text(d.reviewer_name),
  };
}

/** Agency review of one attendance record: original → requests → decisions → corrected. */
export default async function AttendanceRecordPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/attendance/[attendanceId]">) {
  const { organisationId: rawOrganisationId, attendanceId: rawAttendanceId } = await params;
  const context = await loadOrganisationPage(rawOrganisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.ATTENDANCE_VIEW);
  const { organisationId, organisation, can } = context;
  if (organisation.type !== "agency") notFound();
  const parsed = idSchema.safeParse(rawAttendanceId);
  if (!parsed.success) notFound();
  const record = await getAttendanceRecord(organisationId, parsed.data);
  if (!record) notFound();

  const [rows, history, exceptions] = await Promise.all([
    listAgencyAttendance(organisationId, { shiftId: record.shiftId }),
    listAttendanceHistory(record.attendanceId),
    listAttendanceExceptions(record.attendanceId),
  ]);
  const row = rows.find((candidate) => candidate.assignmentId === record.assignmentId);
  if (!row) notFound();
  const canReview = can(CAPABILITIES.ATTENDANCE_REVIEW) === "granted";
  const evidenceAccess = can(CAPABILITIES.ATTENDANCE_LOCATION_VIEW);
  const evidencePath =
    `/app/organisations/${organisationId}/attendance/${record.attendanceId}/evidence` as const;
  const worker = row.workerName ?? "Worker";
  const open = exceptions.filter(
    (exception) => exception.status === "open" || exception.status === "under_review",
  );

  return (
    <>
      <PageHeader
        title={worker}
        back={
          <Link
            href={`/app/organisations/${organisationId}/attendance`}
            className="text-primary underline underline-offset-4"
          >
            Attendance
          </Link>
        }
        description={
          <p className="text-sm">
            {row.facilityName} · {row.locationName} · {formatShiftDate(row)} ·{" "}
            {formatShiftTimeRange(row)} ({row.timezone})
          </p>
        }
        meta={
          <>
            <AttendanceStateBadge clockState={row.clockState} needsReview={row.needsReview} />
            {open.length > 0 ? (
              <StatusChip tone="attention">
                {open.length === 1 ? "1 open exception" : `${open.length} open exceptions`}
              </StatusChip>
            ) : null}
          </>
        }
      />

      <Panel titleId="history-heading" title={<>History</>}>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every recorded event, request and decision, oldest first. Nothing is ever edited or
          removed; corrections are added as new entries.
        </p>
        <DataTableRegion aria-label="Attendance history">
          <DataTable className="min-w-[720px]">
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>When</DataTableHeaderCell>
                <DataTableHeaderCell>What</DataTableHeaderCell>
                <DataTableHeaderCell>Detail</DataTableHeaderCell>
                <DataTableHeaderCell>By</DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {history.map((item) => {
                const line = describe(item, row.timezone);
                return (
                  <DataTableRow key={`${item.kind}-${item.id}`}>
                    <DataTableCell className="whitespace-nowrap">{line.when}</DataTableCell>
                    <DataTableCell className="font-medium">{line.what}</DataTableCell>
                    <DataTableCell>
                      <ul className="flex flex-col gap-0.5">
                        {line.lines.filter(Boolean).map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {line.who || "—"}
                    </DataTableCell>
                  </DataTableRow>
                );
              })}
            </tbody>
          </DataTable>
        </DataTableRegion>
      </Panel>

      {open.length > 0 ? (
        <Panel titleId="record-exceptions-heading" title={<>Open exceptions</>}>
          <ul aria-label="Open exceptions for this record" className="flex flex-col gap-2">
            {open.map((exception) => (
              <li
                key={exception.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-muted p-3 text-sm"
              >
                <StatusChip tone={exception.severity === "urgent" ? "danger" : "attention"}>
                  {ATTENDANCE_EXCEPTION_LABELS[exception.type]}
                </StatusChip>
                {canReview && exception.type !== "manual_correction_requested" ? (
                  <span className="flex flex-wrap gap-2">
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
                    {exception.type === "missed_clock_in" && row.clockInAt === null ? (
                      <InlineActionForm
                        action={reviewExceptionAction}
                        fields={{
                          organisationId,
                          exceptionId: exception.id,
                          status: "resolved",
                          resolution: "not_worked",
                        }}
                        label="Mark not worked"
                        variant="ghost"
                      />
                    ) : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {canReview ? (
        <Panel titleId="adjust-heading" title={<>Record an adjusted time</>}>
          <p className="max-w-2xl text-sm text-muted-foreground">
            For example after a facility discrepancy. A reason is required, the original event stays
            in the history and {worker} is told about the change.
          </p>
          <AdjustAttendanceForm
            organisationId={organisationId}
            attendanceId={record.attendanceId}
            timezone={row.timezone}
            defaultDate={localDate(row.startAt, row.timezone)}
          />
        </Panel>
      ) : null}

      {evidenceAccess !== "not_held" ? (
        <Panel titleId="evidence-heading" title={<>Location evidence</>}>
          {evidenceAccess === "granted" ? (
            <Link
              href={evidencePath}
              className="w-fit text-sm text-primary underline underline-offset-4"
            >
              View raw location evidence
            </Link>
          ) : (
            <StepUpNotice returnTo={evidencePath}>
              Raw location evidence requires verification with your authenticator app.
            </StepUpNotice>
          )}
        </Panel>
      ) : null}
    </>
  );
}
