import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { KeyValueList } from "@/components/ui/key-value-list";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTabs } from "@/components/ui/section-tabs";
import { StatusChip } from "@/components/ui/status-chip";
import {
  AttendanceStateBadge,
  BreakControl,
  ClockControl,
  CorrectionRequestForm,
  listMyAttendance,
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
import { formatWorkedMinutes } from "@/lib/domain/timesheets";

function exceptionLabel(type: string): string {
  return (ATTENDANCE_EXCEPTION_LABELS as Record<string, string>)[type] ?? type;
}

export const metadata: Metadata = { title: "My shifts" };

/** The worker's own assignments at one agency. Nobody else's are ever shown. */
const CARD = "flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card";

export default async function MyShiftsPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/my-shifts">) {
  const { organisationId, organisation } = await loadOrganisationPage(
    (await params).organisationId,
  );
  const worker = await getMyWorkerRecord(organisationId);
  if (!worker) notFound();
  const [assignments, offers, attendance] = await Promise.all([
    listMyShiftAssignments(organisationId),
    listMyShiftOffers(organisationId),
    listMyAttendance(organisationId),
  ]);
  // Display filter over the worker's own assignments (no new query).
  const showPast = (await searchParams).view === "past";
  const base = `/app/organisations/${organisationId}/my-shifts` as const;
  const shownAssignments = assignments.filter((assignment) =>
    showPast ? hasEnded(assignment) : !hasEnded(assignment),
  );
  const attendanceByAssignment = new Map(attendance.map((item) => [item.assignmentId, item]));

  return (
    <>
      <PageHeader
        title="My shifts"
        description={
          <p className="text-sm">
            Shifts {organisation.name} has assigned to you. Times are in the facility&apos;s
            timezone. Accept to confirm you will work the shift, or decline if you cannot.
          </p>
        }
      />

      <section aria-labelledby="my-attendance-heading" className="flex flex-col gap-3">
        <h2
          id="my-attendance-heading"
          className="font-display text-lg font-semibold text-chelth-navy"
        >
          Attendance
        </h2>
        {attendance.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No accepted shifts around today."
            description="Clock-in opens shortly before an accepted shift starts."
          />
        ) : (
          <ul aria-label="My attendance" className="flex flex-col gap-3">
            {attendance.map((item) => (
              <li
                key={item.assignmentId}
                aria-label={`Attendance: ${item.facilityName} ${formatShiftDate(item)}`}
                className={CARD}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-display text-base font-semibold text-chelth-navy">
                    {item.facilityName}
                  </span>
                  <AttendanceStateBadge
                    clockState={item.clockState}
                    needsReview={item.exceptions.some(
                      (exception) =>
                        exception.status === "open" || exception.status === "under_review",
                    )}
                  />
                </div>
                <p className="text-sm">
                  {formatShiftDate(item)} · {formatShiftTimeRange(item)}
                </p>
                <KeyValueList
                  className="rounded-md bg-surface-muted p-3"
                  items={[
                    { label: "Location", value: item.locationName },
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
                {item.canEndBreak ? (
                  <p role="status" className="text-sm font-medium">
                    You are on a break. End it before you clock out.
                  </p>
                ) : null}
                {item.workedMinutes !== null ? (
                  <p className="text-sm">
                    Worked{" "}
                    <span className="font-medium">{formatWorkedMinutes(item.workedMinutes)}</span>
                    {item.breakMinutes ? ` · breaks ${formatWorkedMinutes(item.breakMinutes)}` : ""}
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
                  <p className="text-sm text-muted-foreground">
                    Clock-in opens at {formatLocalClockTime(item.earliestClockInAt, item.timezone)}.
                  </p>
                ) : null}
                {item.exceptions.length > 0 ? (
                  <ul aria-label="Attendance notes" className="flex flex-wrap gap-1">
                    {item.exceptions.map((exception, index) => (
                      <li key={`${exception.type}-${index}`}>
                        <StatusChip
                          tone={
                            exception.status === "open" || exception.status === "under_review"
                              ? "attention"
                              : "neutral"
                          }
                        >
                          {exceptionLabel(exception.type)}
                        </StatusChip>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.corrections.length > 0 ? (
                  <ul aria-label="My correction requests" className="flex flex-col gap-1 text-sm">
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
                            <span className="font-medium">
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
                            <span className="text-muted-foreground">
                              Approved at{" "}
                              {formatLocalClockTime(correction.approvedTime, item.timezone)} instead
                              {correction.adjustmentReason
                                ? ` · ${ADJUSTMENT_REASON_LABELS[correction.adjustmentReason]}`
                                : ""}
                            </span>
                          ) : correction.adjustmentReason ? (
                            <span className="text-muted-foreground">
                              {ADJUSTMENT_REASON_LABELS[correction.adjustmentReason]}
                            </span>
                          ) : null}
                          {correction.reviewerNote ? (
                            <span className="text-muted-foreground">
                              “{correction.reviewerNote}”
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                <details className="rounded-md border border-border text-sm">
                  <summary className="flex min-h-11 cursor-pointer items-center px-3 font-medium text-primary">
                    Request a time correction
                  </summary>
                  <div className="flex flex-col gap-3 border-t border-border p-3">
                    <p className="text-muted-foreground">
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
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="my-offers-heading" className="flex flex-col gap-3">
        <h2 id="my-offers-heading" className="font-display text-lg font-semibold text-chelth-navy">
          Offers
        </h2>
        {offers.length === 0 ? (
          <EmptyState headingLevel={3} title="No shift offers right now." />
        ) : (
          <ul aria-label="Shift offers" className="flex flex-col gap-3">
            {offers.map((offer) => (
              <li
                key={offer.id}
                aria-label={`Offer: ${offer.facilityName} ${formatShiftDate(offer)}`}
                className={CARD}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-display text-base font-semibold text-chelth-navy">
                    {offer.facilityName} · {offer.disciplineName}
                  </span>
                  <OfferStatusBadge status={offer.status} />
                </div>
                <p className="text-sm">
                  {formatShiftDate(offer)} · {formatShiftTimeRange(offer)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {offer.locationName} · {offer.timezone}
                </p>
                {offer.canRespond ? (
                  <>
                    <p className="text-sm text-muted-foreground">
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
      </section>

      <section aria-labelledby="my-shifts-heading" className="flex flex-col gap-3">
        <h2 id="my-shifts-heading" className="font-display text-lg font-semibold text-chelth-navy">
          Assignments
        </h2>
        <SectionTabs
          label="Assignment period"
          tabs={[
            { label: "Upcoming", href: base as Route, current: !showPast },
            { label: "Past", href: `${base}?view=past` as Route, current: showPast },
          ]}
        />
        {shownAssignments.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title={
              assignments.length === 0
                ? "You have no assignments yet."
                : showPast
                  ? "No past assignments."
                  : "You have no upcoming assignments."
            }
            description={
              showPast
                ? "Assignments move here once the shift has ended."
                : "New assignments and accepted offers appear here."
            }
          />
        ) : (
          <ul aria-label="My assignments" className="flex flex-col gap-3">
            {shownAssignments.map((assignment) => (
              <li
                key={assignment.id}
                aria-label={`${assignment.facilityName} ${formatShiftDate(assignment)}`}
                className={CARD}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-display text-base font-semibold text-chelth-navy">
                    {assignment.facilityName} · {assignment.disciplineName}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <AssignmentStatusBadge status={assignment.status} />
                    {assignment.shiftStatus !== "open" ? (
                      <ShiftStatusBadge status={assignment.shiftStatus} />
                    ) : null}
                  </div>
                </div>
                <p className="text-sm">
                  {formatShiftDate(assignment)} · {formatShiftTimeRange(assignment)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {assignment.locationName} · {assignment.timezone}
                </p>
                {assignment.instructions ? (
                  <p className="text-sm whitespace-pre-line">
                    <span className="font-medium">Instructions: </span>
                    {assignment.instructions}
                  </p>
                ) : null}
                {assignment.cancellationReason ? (
                  <p className="text-sm text-muted-foreground">
                    {ASSIGNMENT_CANCELLATION_REASON_LABELS[assignment.cancellationReason]}
                  </p>
                ) : null}
                <DetailDrawerTrigger
                  triggerLabel="Shift details"
                  triggerAccessibleLabel={`Shift details: ${assignment.facilityName} ${formatShiftDate(assignment)}`}
                  triggerClassName="w-fit px-0"
                  title={assignment.facilityName}
                  description={`${formatShiftDate(assignment)} · ${formatShiftTimeRange(assignment)}`}
                >
                  <KeyValueList
                    items={[
                      { label: "Date", value: formatShiftDate(assignment) },
                      { label: "Time", value: formatShiftTimeRange(assignment) },
                      { label: "Timezone", value: assignment.timezone },
                      { label: "Facility", value: assignment.facilityName },
                      { label: "Location", value: assignment.locationName },
                      { label: "Discipline", value: assignment.disciplineName },
                      {
                        label: "Assignment",
                        value: <AssignmentStatusBadge status={assignment.status} />,
                      },
                      ...(assignment.instructions
                        ? [
                            {
                              label: "Instructions",
                              value: (
                                <span className="whitespace-pre-line">
                                  {assignment.instructions}
                                </span>
                              ),
                            },
                          ]
                        : []),
                      ...(attendanceByAssignment.get(assignment.id)
                        ? [
                            {
                              label: "Attendance",
                              value: (
                                <AttendanceStateBadge
                                  clockState={
                                    attendanceByAssignment.get(assignment.id)?.clockState ??
                                    "not_started"
                                  }
                                  needsReview={false}
                                />
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />
                  <p className="text-sm text-muted-foreground">
                    {assignment.canRespond
                      ? "Next: accept or decline this shift on My shifts."
                      : attendanceByAssignment.get(assignment.id)?.canClockIn
                        ? "Next: clock in from the Attendance card when you arrive."
                        : "Attendance opens shortly before the shift starts."}
                  </p>
                </DetailDrawerTrigger>
                {assignment.canRespond ? (
                  <div className="flex flex-wrap gap-2">
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
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
