import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { RefChip } from "@/components/reference/locked-reference";
import { StatusChip } from "@/components/ui/status-chip";
import {
  AttendanceStateBadge,
  BreakControl,
  ClockControl,
  CorrectionRequestForm,
  listMyAttendance,
  type MyAttendance,
} from "@/features/attendance";
import { getReadiness } from "@/features/compliance";
import { facilityImageUrl } from "@/features/facilities";
import { OpenThreadButton } from "@/features/messaging";
import { loadOrganisationPage } from "@/features/organisations";
import {
  acceptAssignmentAction,
  AssignmentStatusBadge,
  declineAssignmentAction,
  listMyShiftAssignments,
  type MyShiftAssignment,
  ShiftStatusBadge,
} from "@/features/shifts";
import { listMyTimesheets, TimesheetStatusBadge } from "@/features/timesheets";
import { getMyWorkerRecord } from "@/features/workforce";
import {
  ADJUSTMENT_REASON_LABELS,
  ATTENDANCE_EXCEPTION_LABELS,
  CORRECTION_RESOLUTION_LABELS,
  CORRECTION_STATUS_LABELS,
  describeCorrectionTarget,
  formatLocalClockTime,
} from "@/lib/domain/attendance";
import { COMPLIANCE_REASON_LABELS, formatCalendarDate } from "@/lib/domain/credentials";
import {
  ASSIGNMENT_CANCELLATION_REASON_LABELS,
  directionsDestination,
  formatAddressLines,
  formatShiftDate,
  formatShiftLength,
  formatShiftTimeRange,
  localDate,
  shiftPeriod,
} from "@/lib/domain/shifts";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";
import { cn } from "@/lib/utils/cn";

import { complianceTone } from "../../../(workspace)/compliance/_components/compliance-tones";
import { DirectionsLink } from "../_components/directions-link";
import { FacilityHero } from "../_components/facility-photo";
import {
  INK,
  StatePanel,
  WORKER_CARD,
  WORKER_PRIMARY_CTA,
  WORKER_SECONDARY_CTA,
} from "../_components/worker-cards";

export const metadata: Metadata = { title: "Shift Details" };

const isOpen = (status: string) => status === "open" || status === "under_review";
const exceptionLabel = (type: string) =>
  (ATTENDANCE_EXCEPTION_LABELS as Record<string, string>)[type] ?? type;
const FULL = "h-12 w-full rounded-[8px] text-[15px] sm:h-12";

/**
 * Shift Details (canonical Worker Mobile screens 2–4, P0-E9-3D-S2): the
 * facility, where and when, role and unit, directions, arrival guidance, the
 * worker-facing contact and the facility's requirements; then the attendance
 * flow (check in → checked in → check out) and the timesheet handoff. All
 * values are the worker's own server read models; context exists only while
 * the assignment is active.
 */
export default async function ShiftDetailsPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/my-shifts/[assignmentId]">) {
  const { organisationId: rawOrganisationId, assignmentId: rawAssignmentId } = await params;
  const { organisationId } = await loadOrganisationPage(rawOrganisationId);
  const assignmentId = z.uuid().safeParse(rawAssignmentId);
  if (!assignmentId.success) notFound();
  const worker = await getMyWorkerRecord(organisationId);
  if (!worker) notFound();
  const [assignments, attendance, timesheets] = await Promise.all([
    listMyShiftAssignments(organisationId),
    listMyAttendance(organisationId),
    listMyTimesheets(organisationId),
  ]);
  const assignment = assignments.find((item) => item.id === assignmentId.data);
  if (!assignment) notFound();
  const item = attendance.find((candidate) => candidate.assignmentId === assignment.id);
  // Live context (address, contact, guidance, requirements) is for work still to do;
  // a past shift shows its record, not directions.
  const active =
    (assignment.status === "assigned" || assignment.status === "accepted") &&
    shiftPeriod(assignment) !== "past";
  const [imageUrl, readiness] = await Promise.all([
    assignment.imagePath ? facilityImageUrl(assignment.imagePath) : Promise.resolve(null),
    active && assignment.shiftStatus === "open"
      ? getReadiness(worker.id, assignment.facilityId)
      : Promise.resolve(null),
  ]);
  const base = `/app/organisations/${organisationId}`;
  const day = localDate(assignment.startAt, assignment.timezone);
  const sheet = timesheets.find((week) => week.periodStart <= day && day <= week.periodEnd);
  const address = active ? assignment.address : null;
  const contact = active ? assignment.contact : null;
  const addressLines = address ? formatAddressLines(address) : [];
  const destination = address ? directionsDestination(address, assignment.facilityName) : null;
  const guidance = active
    ? {
        parking: assignment.parkingInstructions,
        arrival: assignment.arrivalInstructions,
        shift: assignment.instructions,
      }
    : { parking: null, arrival: null, shift: null };
  const requirements = readiness
    ? [
        ...readiness.items.filter((entry) => entry.severity !== "ok"),
        ...readiness.items.filter((entry) => entry.severity === "ok"),
      ].filter((entry) => entry.credentialTypeName)
    : [];

  return (
    <div className="chelth-locked flex flex-col gap-4">
      <Link
        href={`${base}/my-shifts` as Route}
        className="inline-flex min-h-11 w-fit items-center gap-1.5 text-[15px] font-semibold text-chelth-navy"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
        >
          <path d="m15 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        My Shifts
      </Link>

      <FacilityHero url={imageUrl} name={assignment.facilityName} />

      <header className="flex flex-col gap-1.5">
        <h1
          className={cn(
            "font-display text-[24px] leading-[30px] font-bold tracking-[-0.02em] break-words",
            INK,
          )}
        >
          {assignment.facilityName}
        </h1>
        {addressLines.length > 0 ? (
          <p className="flex items-start gap-1.5 text-[14px] leading-5 text-slate-600">
            <span className="mt-px shrink-0 text-chelth-teal-dark [&>svg]:size-4">
              <PinGlyph />
            </span>
            <span>
              <span className="sr-only">Address: </span>
              {addressLines.join(", ")}
            </span>
          </p>
        ) : (
          <p className="text-[14px] leading-5 text-slate-600">{assignment.locationName}</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {item && item.clockState !== "not_started" ? (
            <AttendanceStateBadge
              clockState={item.clockState}
              needsReview={item.exceptions.some((exception) => isOpen(exception.status))}
            />
          ) : (
            <AssignmentStatusBadge status={assignment.status} />
          )}
          {assignment.shiftStatus !== "open" ? (
            <ShiftStatusBadge status={assignment.shiftStatus} />
          ) : null}
        </div>
      </header>

      <div className="flex items-center gap-3 rounded-[12px] border border-[rgba(18,107,103,0.10)] bg-[#f3faf8] px-3.5 py-3">
        <WorkspaceNavIcon
          name="shifts"
          strokeWidth={2.1}
          className="size-5 shrink-0 text-chelth-teal-dark"
        />
        <span className="flex flex-col">
          <span className={cn("text-[15px] font-semibold", INK)}>
            {formatShiftDate(assignment)}
          </span>
          <span className="text-[14px] text-slate-600">
            {formatShiftTimeRange(assignment)} ({formatShiftLength(assignment)})
          </span>
        </span>
      </div>

      <section aria-label="Shift facts" className={cn(WORKER_CARD, "gap-0 py-1")}>
        <Fact icon="workforce" label="Role" value={assignment.disciplineName} />
        {assignment.unitLabel ? (
          <Fact icon="facilities" label="Unit" value={assignment.unitLabel} />
        ) : null}
        <Fact icon="pin" label="Location" value={assignment.locationName} />
        {contact ? (
          <div className="flex items-center gap-3 border-t border-[rgba(18,107,103,0.10)] py-3">
            <FactIcon icon="phone" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px] text-slate-600">Facility contact</span>
              <span className={cn("text-[15px] font-semibold break-words", INK)}>
                {contact.label}
              </span>
              <span className="text-[14px] text-chelth-teal-dark">{contact.phone}</span>
            </span>
            <a
              href={`tel:${contact.phone.replace(/[^+0-9]/g, "")}`}
              className="inline-flex size-12 items-center justify-center rounded-full border border-[rgba(0,90,96,0.25)] bg-white text-chelth-teal-dark shadow-[0_2px_8px_rgba(0,90,96,0.10)]"
            >
              <PhoneGlyph />
              <span className="sr-only">Call {contact.label}</span>
            </a>
          </div>
        ) : null}
      </section>

      {destination ? (
        <DirectionsLink
          destination={destination}
          className={cn(WORKER_CARD, "flex-row items-center gap-3 py-3.5 no-underline")}
        >
          <span
            aria-hidden="true"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-[radial-gradient(circle_at_30%_25%,#f4fdfa_0%,#d3f2e8_45%,#a9e3d3_100%)] text-chelth-teal-dark"
          >
            <PinGlyph />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cn("text-[15px] font-semibold", INK)}>Get directions</span>
            <span className="text-[13px] leading-[18px] text-slate-600">
              {addressLines.join(", ")}
            </span>
          </span>
          <ChevronGlyph />
        </DirectionsLink>
      ) : null}

      {guidance.parking || guidance.arrival || guidance.shift ? (
        <section aria-labelledby="arrival-heading" className={WORKER_CARD}>
          <h2 id="arrival-heading" className={cn("text-[16px] leading-[22px] font-semibold", INK)}>
            Arrival
          </h2>
          <dl className="flex flex-col gap-2.5 text-[14px] leading-5">
            {guidance.parking ? <Guidance label="Parking" text={guidance.parking} /> : null}
            {guidance.arrival ? (
              <Guidance label="Arrival and check-in" text={guidance.arrival} />
            ) : null}
            {guidance.shift ? <Guidance label="For this shift" text={guidance.shift} /> : null}
          </dl>
        </section>
      ) : null}

      {requirements.length > 0 ? (
        <section aria-labelledby="requirements-heading" className={WORKER_CARD}>
          <h2
            id="requirements-heading"
            className={cn("text-[16px] leading-[22px] font-semibold", INK)}
          >
            Requirements
          </h2>
          <ul aria-label="Shift requirements" className="flex flex-col gap-2.5">
            {requirements.map((entry, index) => (
              <li
                key={`${entry.requirementId ?? entry.reason}-${index}`}
                className="flex items-start gap-3"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-white",
                    entry.severity === "ok" ? "bg-success-indicator" : "bg-warning-indicator",
                  )}
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="size-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.4}
                  >
                    {entry.severity === "ok" ? (
                      <path
                        d="m4 8.5 2.5 2.5L12 5.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : (
                      <path d="M8 4.5v4.5M8 11.5v.01" strokeLinecap="round" />
                    )}
                  </svg>
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className={cn("text-[15px] leading-5 font-semibold", INK)}>
                    {entry.credentialTypeName}
                  </span>
                  <span className="text-[13px] leading-[18px] text-slate-600">
                    {entry.effectiveExpiryDate
                      ? `${entry.severity === "ok" ? "Valid until" : "Expires"} ${formatCalendarDate(entry.effectiveExpiryDate)}`
                      : COMPLIANCE_REASON_LABELS[entry.reason]}
                  </span>
                  {entry.severity !== "ok" ? (
                    <RefChip tone={complianceTone(entry.reason)} className="w-fit font-semibold">
                      {COMPLIANCE_REASON_LABELS[entry.reason]}
                    </RefChip>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {requirements.some((entry) => entry.severity !== "ok") ? (
            <Link
              href={`${base}/my-credentials` as Route}
              className="inline-flex min-h-11 items-center text-[14px] font-semibold text-primary underline underline-offset-4"
            >
              Update my credentials
            </Link>
          ) : null}
        </section>
      ) : null}

      {assignment.cancellationReason ? (
        <StatePanel tone="warning" title="Shift cancelled">
          <p className="text-slate-700">
            {ASSIGNMENT_CANCELLATION_REASON_LABELS[assignment.cancellationReason]}
          </p>
        </StatePanel>
      ) : null}

      {assignment.canRespond ? (
        <section aria-label="Respond to this shift" className="grid grid-cols-2 gap-2">
          <InlineActionForm
            action={acceptAssignmentAction}
            fields={{ organisationId, assignmentId: assignment.id }}
            label="Accept"
            accessibleLabel={`Accept shift at ${assignment.facilityName}`}
            variant="primary"
            buttonClassName={FULL}
          />
          <InlineActionForm
            action={declineAssignmentAction}
            fields={{ organisationId, assignmentId: assignment.id }}
            label="Decline"
            accessibleLabel={`Decline shift at ${assignment.facilityName}`}
            buttonClassName={FULL}
          />
        </section>
      ) : null}

      {item ? (
        <AttendanceSection
          assignment={assignment}
          item={item}
          organisationId={organisationId}
          sheet={sheet}
          timesheetHref={sheet ? `${base}/timesheets/${sheet.id}` : null}
        />
      ) : active && assignment.shiftStatus === "open" ? (
        <StatePanel tone="info" title="Check in on the day">
          <p className="text-slate-700">
            Check-in opens shortly before the shift starts. Come back to this page when you arrive.
          </p>
        </StatePanel>
      ) : null}

      <section aria-labelledby="help-heading" className={WORKER_CARD}>
        <h2 id="help-heading" className={cn("text-[16px] leading-[22px] font-semibold", INK)}>
          Need help?
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <OpenThreadButton
            organisationId={organisationId}
            surface="worker"
            target={{ kind: "worker", agencyWorkerId: worker.id, shiftId: assignment.shiftId }}
            label="Message agency"
            className={cn(WORKER_SECONDARY_CTA, "w-full gap-2", !active && "sm:col-span-2")}
          >
            <MessageGlyph />
          </OpenThreadButton>
          {contact ? (
            <a
              href={`tel:${contact.phone.replace(/[^+0-9]/g, "")}`}
              className={cn(WORKER_SECONDARY_CTA, "gap-2")}
            >
              <PhoneGlyph />
              Call contact
              <span className="sr-only">: {contact.label}</span>
            </a>
          ) : null}
          {destination ? (
            <DirectionsLink destination={destination} className={cn(WORKER_SECONDARY_CTA, "gap-2")}>
              <PinGlyph />
              Get directions
            </DirectionsLink>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function AttendanceSection({
  assignment,
  item,
  organisationId,
  sheet,
  timesheetHref,
}: {
  assignment: MyShiftAssignment;
  item: MyAttendance;
  organisationId: string;
  sheet:
    | {
        periodStart: string;
        periodEnd: string;
        status: Parameters<typeof TimesheetStatusBadge>[0]["status"];
        canSubmit: boolean;
      }
    | undefined;
  timesheetHref: string | null;
}) {
  const needsReview = item.exceptions.some((exception) => isOpen(exception.status));
  const tz = item.timezone;
  const totalMinutes =
    item.clockInAt && item.clockOutAt
      ? Math.round(
          (new Date(item.clockOutAt).getTime() - new Date(item.clockInAt).getTime()) / 60_000,
        )
      : null;
  return (
    <section
      aria-label={`Attendance: ${assignment.facilityName} ${formatShiftDate(assignment)}`}
      className={WORKER_CARD}
    >
      <div className="flex flex-col gap-1.5">
        <h2 id="attendance-heading" className={cn("text-[16px] leading-[22px] font-semibold", INK)}>
          {item.clockState === "clocked_out"
            ? "Worked Time"
            : item.clockState === "not_started"
              ? "Check In"
              : "Current Shift"}
        </h2>
        <span className="flex flex-wrap gap-1.5">
          <AttendanceStateBadge clockState={item.clockState} needsReview={needsReview} />
          {item.clockState === "clocked_out" ? (
            <RefChip tone="success" className="font-semibold">
              From check in / out
            </RefChip>
          ) : null}
        </span>
      </div>

      {/* Check-in context: what is being verified (canonical screen 3). */}
      {item.clockState === "not_started" ? (
        <p className="text-[13px] leading-[18px] text-slate-600">
          {assignment.facilityName} · {formatShiftDate(assignment)} ·{" "}
          {formatShiftTimeRange(assignment)}
          {" · "}
          {assignment.disciplineName}
          {assignment.unitLabel ? ` · ${assignment.unitLabel}` : ""}
        </p>
      ) : null}

      {item.canEndBreak ? (
        <>
          <StatePanel tone="info" title="On a break">
            <p role="status" className="text-slate-600">
              You are on a break. End it before you clock out.
            </p>
          </StatePanel>
          <BreakControl
            organisationId={organisationId}
            assignmentId={item.assignmentId}
            kind="end"
            facilityName={item.facilityName}
          />
        </>
      ) : item.canClockIn ? (
        <ClockControl
          organisationId={organisationId}
          assignmentId={item.assignmentId}
          kind="in"
          locationRequired={item.locationRequired}
          facilityName={item.facilityName}
        />
      ) : item.canClockOut ? (
        <div className="flex flex-col gap-2.5">
          <StatePanel tone="success" title="Checked in successfully">
            <p className="text-slate-700">
              Today at {formatLocalClockTime(item.clockInAt, tz)} · recorded at Chelth&apos;s server
              time.
            </p>
          </StatePanel>
          <dl className="flex items-start gap-3 rounded-[12px] border border-[rgba(18,107,103,0.10)] px-3.5 py-3">
            <WorkspaceNavIcon
              name="attendance"
              strokeWidth={2}
              className="mt-0.5 size-5 shrink-0 text-chelth-teal-dark"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className={cn("text-[14px] font-semibold", INK)}>Current Shift</dt>
                <dd>
                  <RefChip tone="success" className="font-semibold">
                    Checked In
                  </RefChip>
                </dd>
              </div>
              <dd className="text-[13px] text-slate-600">
                {formatShiftTimeRange(assignment)}
                <br />
                {assignment.disciplineName}
                {assignment.unitLabel ? ` · ${assignment.unitLabel}` : ""}
              </dd>
            </div>
          </dl>
          <ClockControl
            organisationId={organisationId}
            assignmentId={item.assignmentId}
            kind="out"
            locationRequired={item.locationRequired}
            facilityName={item.facilityName}
          />
          {item.canStartBreak ? (
            <BreakControl
              organisationId={organisationId}
              assignmentId={item.assignmentId}
              kind="start"
              facilityName={item.facilityName}
            />
          ) : null}
          <p className="text-center text-[13px] text-slate-600">
            You can check out when your shift is complete.
          </p>
        </div>
      ) : item.clockState === "not_started" && item.shiftStatus === "open" ? (
        <p className="rounded-[10px] bg-[#f6fbfa] px-3 py-2.5 text-[13px] text-slate-600">
          Check-in opens at {formatLocalClockTime(item.earliestClockInAt, tz)}.
        </p>
      ) : null}

      {item.clockState === "clocked_out" ? (
        <>
          <p className="text-[13px] leading-[18px] text-slate-600">
            Your attendance has been recorded. Your worked time goes to your weekly timesheet — no
            need to type it in.
          </p>
          <dl
            aria-label="Worked time"
            className="flex flex-col divide-y divide-[rgba(18,107,103,0.10)] rounded-[12px] border border-[rgba(18,107,103,0.10)]"
          >
            <Row
              label="Check In"
              value={formatLocalClockTime(item.clockInAt, tz)}
              chip={needsReview ? undefined : "Recorded"}
            />
            <Row
              label="Check Out"
              value={formatLocalClockTime(item.clockOutAt, tz)}
              chip={needsReview ? undefined : "Recorded"}
            />
            <Row
              label="Total Hours"
              value={totalMinutes !== null ? formatWorkedMinutes(totalMinutes) : "—"}
            />
            <Row label="Break (unpaid)" value={formatWorkedMinutes(item.breakMinutes ?? 0)} />
            <Row
              label="Worked Hours"
              value={item.workedMinutes !== null ? formatWorkedMinutes(item.workedMinutes) : "—"}
              strong
            />
          </dl>
          {sheet && timesheetHref ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-700">
                <span>Week {formatPeriod(sheet.periodStart, sheet.periodEnd)}</span>
                <TimesheetStatusBadge status={sheet.status} />
              </div>
              <Link href={timesheetHref as Route} className={cn(WORKER_PRIMARY_CTA, "gap-2")}>
                {sheet.canSubmit ? "Review and submit timesheet" : "View timesheet"}
              </Link>
              <p className="text-center text-[12.5px] text-slate-600">
                Your timesheet is sent to your agency for review and approval.
              </p>
            </div>
          ) : null}
        </>
      ) : null}

      {item.exceptions.length > 0 ? (
        <StatePanel
          tone={needsReview ? "warning" : "info"}
          title={needsReview ? "Review required" : "Reviewed by your agency"}
        >
          <p className="text-slate-600">
            {needsReview
              ? "Your attendance is recorded. Your agency will review these notes."
              : "These notes have been reviewed."}
          </p>
          <ul aria-label="Attendance notes" className="flex flex-wrap gap-1.5 pt-0.5">
            {item.exceptions.map((exception, index) => (
              <li key={`${exception.type}-${index}`}>
                <StatusChip tone={isOpen(exception.status) ? "attention" : "neutral"}>
                  {exceptionLabel(exception.type)}
                </StatusChip>
              </li>
            ))}
          </ul>
        </StatePanel>
      ) : null}

      {item.corrections.length > 0 ? (
        <ul
          aria-label="My correction requests"
          className="flex flex-col gap-1.5 rounded-[10px] bg-[#f6fbfa] px-3 py-2.5 text-[13px] leading-[18px] text-slate-700"
        >
          {item.corrections.map((correction) => {
            const target = describeCorrectionTarget(correction.eventType, correction.segment);
            return (
              <li key={correction.id} className="flex flex-col">
                <span>
                  {correction.origin === "reviewer_adjustment"
                    ? `Your agency set the ${target} to `
                    : `You asked for ${target} `}
                  {formatLocalClockTime(correction.requestedTime, tz)}:{" "}
                  <span className="font-semibold">
                    {correction.origin === "reviewer_adjustment"
                      ? "Adjusted"
                      : CORRECTION_STATUS_LABELS[correction.status]}
                  </span>
                  {correction.resolution && correction.status === "rejected"
                    ? ` (${CORRECTION_RESOLUTION_LABELS[correction.resolution]})`
                    : ""}
                </span>
                {correction.resolution === "approved_with_adjustment" &&
                correction.origin === "worker_request" ? (
                  <span className="text-slate-600">
                    Approved at {formatLocalClockTime(correction.approvedTime, tz)} instead
                    {correction.adjustmentReason
                      ? ` · ${ADJUSTMENT_REASON_LABELS[correction.adjustmentReason]}`
                      : ""}
                  </span>
                ) : correction.adjustmentReason ? (
                  <span className="text-slate-600">
                    {ADJUSTMENT_REASON_LABELS[correction.adjustmentReason]}
                  </span>
                ) : null}
                {correction.reviewerNote ? (
                  <span className="text-slate-600">“{correction.reviewerNote}”</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <details className="rounded-[10px] border border-[rgba(18,107,103,0.12)] text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 font-semibold text-primary">
          Request a time correction
        </summary>
        <div className="flex flex-col gap-3 border-t border-[rgba(18,107,103,0.12)] p-3">
          <p className="text-slate-600">
            Your original clock record stays exactly as recorded. A correction is added alongside it
            for your agency to review.
          </p>
          <CorrectionRequestForm
            organisationId={organisationId}
            assignmentId={item.assignmentId}
            timezone={tz}
            defaultDate={localDate(item.startAt, tz)}
          />
        </div>
      </details>
    </section>
  );
}

function Row({
  label,
  value,
  chip,
  strong = false,
}: {
  label: string;
  value: string;
  chip?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <dt className="text-[13.5px] text-slate-600">{label}</dt>
      <dd className="flex items-center gap-2">
        <span
          className={cn(
            "tabular-nums",
            strong ? "text-[16px] font-bold" : "text-[15px] font-semibold",
            INK,
          )}
        >
          {value}
        </span>
        {chip ? (
          <RefChip tone="success" className="font-semibold">
            {chip}
          </RefChip>
        ) : null}
      </dd>
    </div>
  );
}

function Fact({
  icon,
  label,
  value,
}: {
  icon: "workforce" | "facilities" | "pin";
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-[rgba(18,107,103,0.10)] py-3 first:border-t-0">
      <FactIcon icon={icon} />
      <span className="w-20 shrink-0 text-[13.5px] text-slate-600">{label}</span>
      <span className={cn("min-w-0 flex-1 text-[15px] font-medium break-words", INK)}>{value}</span>
    </div>
  );
}

function FactIcon({ icon }: { icon: "workforce" | "facilities" | "pin" | "phone" }) {
  return (
    <span aria-hidden="true" className="flex w-6 shrink-0 justify-center text-chelth-teal-dark">
      {icon === "phone" ? (
        <PhoneGlyph />
      ) : icon === "pin" ? (
        <PinGlyph />
      ) : (
        <WorkspaceNavIcon name={icon} strokeWidth={2} className="size-5" />
      )}
    </span>
  );
}

function Guidance({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[10px] bg-[#f6fbfa] px-3 py-2.5">
      <dt className="text-[12.5px] font-semibold tracking-wide text-slate-600 uppercase">
        {label}
      </dt>
      <dd className="whitespace-pre-line text-slate-700">{text}</dd>
    </div>
  );
}

function MessageGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 5h16v11H9l-5 4z" />
    </svg>
  );
}

function PhoneGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
    </svg>
  );
}

function PinGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-5 shrink-0 text-slate-400"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
