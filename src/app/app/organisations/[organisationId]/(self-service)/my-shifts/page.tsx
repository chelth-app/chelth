import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTabs } from "@/components/ui/section-tabs";
import { StatusChip } from "@/components/ui/status-chip";
import {
  AttendanceStateBadge,
  BreakControl,
  ClockControl,
  CorrectionRequestForm,
  listMyAttendance,
  type MyAttendance,
} from "@/features/attendance";
import { loadOrganisationPage } from "@/features/organisations";
import {
  acceptAssignmentAction,
  AssignmentStatusBadge,
  declineAssignmentAction,
  listMyShiftAssignments,
  listMyShiftOffers,
  OfferStatusBadge,
  RespondToOffer,
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
import {
  ASSIGNMENT_CANCELLATION_REASON_LABELS,
  formatShiftDate,
  formatShiftTimeRange,
  hasEnded,
  localDate,
} from "@/lib/domain/shifts";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";

import {
  FactRows,
  FacilityTile,
  INK,
  ShiftIdentity,
  StatePanel,
  TimePair,
  WORKER_CARD,
  WorkerEmpty,
  WorkerSection,
} from "./_components/worker-cards";

function exceptionLabel(type: string): string {
  return (ATTENDANCE_EXCEPTION_LABELS as Record<string, string>)[type] ?? type;
}

const isOpen = (status: string) => status === "open" || status === "under_review";

export const metadata: Metadata = { title: "My Shifts" };

/**
 * The worker's own shifts at one agency (locked Worker Mobile reference,
 * P0-E8-W1): today's attendance with the check-in / check-out flow and the
 * timesheet handoff, offers, and upcoming / past assignments with Shift
 * Details. Nobody else's data is ever read. Times are server-recorded; the
 * location check runs only inside the existing clock action.
 */
export default async function MyShiftsPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/my-shifts">) {
  const { organisationId, organisation } = await loadOrganisationPage(
    (await params).organisationId,
  );
  const worker = await getMyWorkerRecord(organisationId);
  if (!worker) notFound();
  const [assignments, offers, attendance, timesheets] = await Promise.all([
    listMyShiftAssignments(organisationId),
    listMyShiftOffers(organisationId),
    listMyAttendance(organisationId),
    listMyTimesheets(organisationId),
  ]);
  // Display filter over the worker's own assignments (no new query).
  const showPast = (await searchParams).view === "past";
  const orgBase = `/app/organisations/${organisationId}` as const;
  const base = `${orgBase}/my-shifts` as const;
  const shownAssignments = assignments.filter((assignment) =>
    showPast ? hasEnded(assignment) : !hasEnded(assignment),
  );
  const attendanceByAssignment = new Map(attendance.map((item) => [item.assignmentId, item]));
  /** The worker's own timesheet week containing this shift's local date. */
  const timesheetFor = (item: MyAttendance) => {
    const day = localDate(item.startAt, item.timezone);
    return timesheets.find((sheet) => sheet.periodStart <= day && day <= sheet.periodEnd);
  };

  return (
    <div className="chelth-locked flex flex-col gap-6">
      <PageHeader
        variant="reference"
        title="My Shifts"
        description={
          <p>Your shifts with {organisation.name}. Times are in the facility&apos;s timezone.</p>
        }
      />

      <WorkerSection
        id="my-attendance-heading"
        title="Attendance"
        note="Clock in when you arrive and clock out when your shift is complete."
      >
        {attendance.length === 0 ? (
          <WorkerEmpty
            title="No accepted shifts around today."
            note="Clock-in opens shortly before an accepted shift starts."
          />
        ) : (
          <ul aria-label="My attendance" className="flex flex-col gap-3">
            {attendance.map((item) => {
              const needsReview = item.exceptions.some((exception) => isOpen(exception.status));
              const sheet = item.clockState === "clocked_out" ? timesheetFor(item) : undefined;
              return (
                <li
                  key={item.assignmentId}
                  aria-label={`Attendance: ${item.facilityName} ${formatShiftDate(item)}`}
                  className={WORKER_CARD}
                >
                  <ShiftIdentity
                    title={item.facilityName}
                    subtitle={item.locationName}
                    chips={
                      <AttendanceStateBadge
                        clockState={item.clockState}
                        needsReview={needsReview}
                      />
                    }
                  />
                  <FactRows
                    rows={[
                      { icon: "shifts", label: "Date", value: formatShiftDate(item) },
                      { icon: "attendance", label: "Time", value: formatShiftTimeRange(item) },
                    ]}
                  />
                  {item.clockState !== "not_started" ? (
                    <TimePair
                      items={[
                        {
                          label: "Clocked in",
                          value: formatLocalClockTime(item.clockInAt, item.timezone),
                        },
                        {
                          label: "Clocked out",
                          value: formatLocalClockTime(item.clockOutAt, item.timezone),
                        },
                      ]}
                    />
                  ) : null}
                  {item.canEndBreak ? (
                    <StatePanel tone="info" title="On a break">
                      <p role="status" className="text-slate-600">
                        You are on a break. End it before you clock out.
                      </p>
                    </StatePanel>
                  ) : null}
                  {item.workedMinutes !== null ? (
                    <p className="text-[14px] leading-5 text-slate-700">
                      Worked{" "}
                      <span className={`font-semibold tabular-nums ${INK}`}>
                        {formatWorkedMinutes(item.workedMinutes)}
                      </span>
                      {item.breakMinutes
                        ? ` · breaks ${formatWorkedMinutes(item.breakMinutes)}`
                        : ""}
                    </p>
                  ) : null}
                  {item.canEndBreak ? (
                    <BreakControl
                      organisationId={organisationId}
                      assignmentId={item.assignmentId}
                      kind="end"
                      facilityName={item.facilityName}
                    />
                  ) : item.canClockIn ? (
                    <ClockControl
                      organisationId={organisationId}
                      assignmentId={item.assignmentId}
                      kind="in"
                      locationRequired={item.locationRequired}
                      facilityName={item.facilityName}
                    />
                  ) : item.canClockOut ? (
                    <div className="flex flex-col gap-2">
                      <StatePanel tone="success" title="Checked in">
                        <p className="text-slate-600">
                          Clocked in at {formatLocalClockTime(item.clockInAt, item.timezone)} ·
                          shift {formatShiftTimeRange(item)}. Clock out when your shift is complete.
                        </p>
                      </StatePanel>
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
                    </div>
                  ) : item.clockState === "not_started" && item.shiftStatus === "open" ? (
                    <p className="rounded-[10px] bg-[#f6fbfa] px-3 py-2.5 text-[13px] text-slate-600">
                      Clock-in opens at{" "}
                      {formatLocalClockTime(item.earliestClockInAt, item.timezone)}.
                    </p>
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
                  {item.clockState === "clocked_out" ? (
                    <StatePanel tone="success" title="Attendance captured">
                      <p className="text-slate-600">
                        Your worked time goes to your weekly timesheet from this record — no need to
                        type it in.
                      </p>
                      {sheet ? (
                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          <span className="text-slate-700">
                            Week {formatPeriod(sheet.periodStart, sheet.periodEnd)}
                          </span>
                          <TimesheetStatusBadge status={sheet.status} />
                          <Link
                            href={`${orgBase}/timesheets/${sheet.id}` as Route}
                            className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
                          >
                            View timesheet
                          </Link>
                        </div>
                      ) : null}
                    </StatePanel>
                  ) : null}
                  {item.corrections.length > 0 ? (
                    <ul
                      aria-label="My correction requests"
                      className="flex flex-col gap-1.5 rounded-[10px] bg-[#f6fbfa] px-3 py-2.5 text-[13px] leading-[18px] text-slate-700"
                    >
                      {item.corrections.map((correction) => {
                        const target = describeCorrectionTarget(
                          correction.eventType,
                          correction.segment,
                        );
                        return (
                          <li key={correction.id} className="flex flex-col">
                            <span>
                              {correction.origin === "reviewer_adjustment"
                                ? `Your agency set the ${target} to `
                                : `You asked for ${target} `}
                              {formatLocalClockTime(correction.requestedTime, item.timezone)}:{" "}
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
                                Approved at{" "}
                                {formatLocalClockTime(correction.approvedTime, item.timezone)}{" "}
                                instead
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
                        Your original clock record stays exactly as recorded. A correction is added
                        alongside it for your agency to review.
                      </p>
                      <CorrectionRequestForm
                        organisationId={organisationId}
                        assignmentId={item.assignmentId}
                        timezone={item.timezone}
                        defaultDate={localDate(item.startAt, item.timezone)}
                      />
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </WorkerSection>

      <WorkerSection id="my-offers-heading" title="Offers">
        {offers.length === 0 ? (
          <WorkerEmpty title="No shift offers right now." />
        ) : (
          <ul aria-label="Shift offers" className="flex flex-col gap-3">
            {offers.map((offer) => (
              <li
                key={offer.id}
                aria-label={`Offer: ${offer.facilityName} ${formatShiftDate(offer)}`}
                className={WORKER_CARD}
              >
                <ShiftIdentity
                  title={offer.facilityName}
                  subtitle={offer.disciplineName}
                  chips={<OfferStatusBadge status={offer.status} />}
                />
                <FactRows
                  rows={[
                    { icon: "shifts", label: "Date", value: formatShiftDate(offer) },
                    { icon: "attendance", label: "Time", value: formatShiftTimeRange(offer) },
                    {
                      icon: "pin",
                      label: "Location",
                      value: `${offer.locationName} · ${offer.timezone}`,
                    },
                  ]}
                />
                {offer.canRespond ? (
                  <>
                    <p className="text-[13px] leading-[18px] text-slate-600">
                      Respond by{" "}
                      {formatShiftDate({ startAt: offer.expiresAt, timezone: offer.timezone })},{" "}
                      {new Intl.DateTimeFormat("en-US", {
                        timeZone: offer.timezone,
                        hour: "numeric",
                        minute: "2-digit",
                        timeZoneName: "short",
                      }).format(new Date(offer.expiresAt))}
                      . Accepting assigns you only if the shift still has a place and you still meet
                      its requirements.
                    </p>
                    <RespondToOffer
                      organisationId={organisationId}
                      offerId={offer.id}
                      facilityName={offer.facilityName}
                    />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </WorkerSection>

      <WorkerSection id="my-shifts-heading" title="Assignments">
        <SectionTabs
          label="Assignment period"
          tabs={[
            { label: "Upcoming", href: base as Route, current: !showPast },
            { label: "Past", href: `${base}?view=past` as Route, current: showPast },
          ]}
        />
        {shownAssignments.length === 0 ? (
          <WorkerEmpty
            title={
              assignments.length === 0
                ? "You have no assignments yet."
                : showPast
                  ? "No past assignments."
                  : "You have no upcoming assignments."
            }
            note={
              showPast
                ? "Assignments move here once the shift has ended."
                : "New assignments and accepted offers appear here."
            }
          />
        ) : (
          <ul aria-label="My assignments" className="flex flex-col gap-3">
            {shownAssignments.map((assignment) => {
              const attendanceItem = attendanceByAssignment.get(assignment.id);
              return (
                <li
                  key={assignment.id}
                  aria-label={`${assignment.facilityName} ${formatShiftDate(assignment)}`}
                  className={WORKER_CARD}
                >
                  <ShiftIdentity
                    title={assignment.facilityName}
                    subtitle={assignment.disciplineName}
                    chips={
                      <>
                        <AssignmentStatusBadge status={assignment.status} />
                        {assignment.shiftStatus !== "open" ? (
                          <ShiftStatusBadge status={assignment.shiftStatus} />
                        ) : null}
                      </>
                    }
                  />
                  <FactRows
                    rows={[
                      { icon: "shifts", label: "Date", value: formatShiftDate(assignment) },
                      {
                        icon: "attendance",
                        label: "Time",
                        value: formatShiftTimeRange(assignment),
                      },
                      {
                        icon: "pin",
                        label: "Location",
                        value: `${assignment.locationName} · ${assignment.timezone}`,
                      },
                    ]}
                  />
                  {assignment.instructions ? (
                    <p className="rounded-[10px] bg-[#f6fbfa] px-3 py-2.5 text-[13px] leading-[18px] whitespace-pre-line text-slate-700">
                      <span className="font-semibold">Instructions: </span>
                      {assignment.instructions}
                    </p>
                  ) : null}
                  {assignment.cancellationReason ? (
                    <p className="text-[13px] text-slate-600">
                      {ASSIGNMENT_CANCELLATION_REASON_LABELS[assignment.cancellationReason]}
                    </p>
                  ) : null}
                  {assignment.canRespond ? (
                    <div className="grid grid-cols-2 gap-2">
                      <InlineActionForm
                        action={acceptAssignmentAction}
                        fields={{ organisationId, assignmentId: assignment.id }}
                        label="Accept"
                        accessibleLabel={`Accept shift at ${assignment.facilityName}`}
                        variant="primary"
                      />
                      <InlineActionForm
                        action={declineAssignmentAction}
                        fields={{ organisationId, assignmentId: assignment.id }}
                        label="Decline"
                        accessibleLabel={`Decline shift at ${assignment.facilityName}`}
                      />
                    </div>
                  ) : null}
                  <DetailDrawerTrigger
                    triggerLabel="View Shift Details"
                    triggerAccessibleLabel={`Shift details: ${assignment.facilityName} ${formatShiftDate(assignment)}`}
                    triggerClassName="h-12 w-full justify-center rounded-[8px] bg-[linear-gradient(180deg,#00666c,#004f55)] text-[15px] font-semibold text-white no-underline shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_14px_-4px_rgba(0,58,64,0.45)] hover:bg-transparent hover:brightness-110"
                    title={assignment.facilityName}
                    width="profile"
                  >
                    <div className="flex min-h-full flex-col gap-4 text-[14px] leading-5">
                      <div className="flex items-start gap-3.5">
                        <FacilityTile size="lg" />
                        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
                          <p
                            className={`font-display text-[20px] leading-[26px] font-bold tracking-[-0.02em] ${INK}`}
                          >
                            {assignment.facilityName}
                          </p>
                          <p className="text-[13.5px] text-slate-600">{assignment.locationName}</p>
                          <div className="flex flex-wrap gap-1.5">
                            <AssignmentStatusBadge status={assignment.status} />
                            {attendanceItem ? (
                              <AttendanceStateBadge
                                clockState={attendanceItem.clockState}
                                needsReview={attendanceItem.exceptions.some((exception) =>
                                  isOpen(exception.status),
                                )}
                              />
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 rounded-[12px] border border-[rgba(18,107,103,0.10)] bg-[#f6fbfa] px-3.5 py-3">
                        <WorkspaceNavIcon
                          name="shifts"
                          strokeWidth={2.1}
                          className="size-5 shrink-0 text-chelth-teal-dark"
                        />
                        <span className="flex flex-col">
                          <span className={`font-semibold ${INK}`}>
                            {formatShiftDate(assignment)}
                          </span>
                          <span className="text-slate-600">
                            {formatShiftTimeRange(assignment)} · {assignment.timezone}
                          </span>
                        </span>
                      </div>
                      <FactRows
                        rows={[
                          { icon: "workforce", label: "Role", value: assignment.disciplineName },
                          { icon: "facilities", label: "Facility", value: assignment.facilityName },
                          { icon: "pin", label: "Location", value: assignment.locationName },
                        ]}
                      />
                      {assignment.instructions ? (
                        <section
                          aria-labelledby={`instructions-${assignment.id}`}
                          className="flex flex-col gap-1.5 border-t border-[rgba(18,107,103,0.12)] pt-3.5"
                        >
                          <h3
                            id={`instructions-${assignment.id}`}
                            className={`text-[16px] leading-[22px] font-semibold ${INK}`}
                          >
                            Instructions
                          </h3>
                          <p className="whitespace-pre-line text-slate-700">
                            {assignment.instructions}
                          </p>
                        </section>
                      ) : null}
                      <StatePanel
                        tone={attendanceItem?.clockState === "clocked_out" ? "success" : "info"}
                        title="Next step"
                      >
                        <p className="text-slate-600">
                          {assignment.canRespond
                            ? "Accept or decline this shift on My Shifts."
                            : attendanceItem?.canClockIn
                              ? "Clock in from the Attendance card when you arrive."
                              : attendanceItem?.canClockOut
                                ? "You are clocked in. Clock out from the Attendance card when your shift is complete."
                                : attendanceItem?.clockState === "clocked_out"
                                  ? "Attendance captured. Your worked time is on your weekly timesheet."
                                  : "Attendance opens shortly before the shift starts."}
                        </p>
                      </StatePanel>
                    </div>
                  </DetailDrawerTrigger>
                </li>
              );
            })}
          </ul>
        )}
      </WorkerSection>
    </div>
  );
}
