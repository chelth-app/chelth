import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { Badge } from "@/components/ui/badge";
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
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}/attendance`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          Attendance
        </Link>
        <h1 className="text-2xl font-semibold">{worker}</h1>
        <p className="text-sm text-muted-foreground">
          {row.facilityName} · {row.locationName} · {formatShiftDate(row)} ·{" "}
          {formatShiftTimeRange(row)} ({row.timezone})
        </p>
        <div>
          <AttendanceStateBadge clockState={row.clockState} needsReview={row.needsReview} />
        </div>
      </header>

      <section aria-labelledby="history-heading" className="flex flex-col gap-3">
        <h2 id="history-heading" className="text-lg font-semibold">
          History
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every recorded event, request and decision, oldest first. Nothing is ever edited or
          removed; corrections are added as new entries.
        </p>
        <div
          role="region"
          aria-label="Attendance history"
          tabIndex={0}
          className="overflow-x-auto rounded-lg border border-border bg-surface"
        >
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  When
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  What
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Detail
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  By
                </th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => {
                const line = describe(item, row.timezone);
                return (
                  <tr
                    key={`${item.kind}-${item.id}`}
                    className="border-b border-border align-top last:border-0"
                  >
                    <td className="px-3 py-2 whitespace-nowrap">{line.when}</td>
                    <td className="px-3 py-2 font-medium">{line.what}</td>
                    <td className="px-3 py-2">
                      <ul className="flex flex-col gap-0.5">
                        {line.lines.filter(Boolean).map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{line.who || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {open.length > 0 ? (
        <section aria-labelledby="record-exceptions-heading" className="flex flex-col gap-3">
          <h2 id="record-exceptions-heading" className="text-lg font-semibold">
            Open exceptions
          </h2>
          <ul aria-label="Open exceptions for this record" className="flex flex-col gap-2">
            {open.map((exception) => (
              <li
                key={exception.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
              >
                <Badge tone={exception.severity === "urgent" ? "danger" : "warning"}>
                  {ATTENDANCE_EXCEPTION_LABELS[exception.type]}
                </Badge>
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
        </section>
      ) : null}

      {canReview ? (
        <section aria-labelledby="adjust-heading" className="flex flex-col gap-3">
          <h2 id="adjust-heading" className="text-lg font-semibold">
            Record an adjusted time
          </h2>
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
        </section>
      ) : null}

      {evidenceAccess !== "not_held" ? (
        <section aria-labelledby="evidence-heading" className="flex flex-col gap-2">
          <h2 id="evidence-heading" className="text-lg font-semibold">
            Location evidence
          </h2>
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
        </section>
      ) : null}
    </>
  );
}
