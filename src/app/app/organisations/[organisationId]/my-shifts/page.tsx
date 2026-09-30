import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { Badge } from "@/components/ui/badge";
import {
  AttendanceStateBadge,
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
  ATTENDANCE_EXCEPTION_LABELS,
  CORRECTION_RESOLUTION_LABELS,
  CORRECTION_STATUS_LABELS,
  formatLocalClockTime,
} from "@/lib/domain/attendance";
import {
  ASSIGNMENT_CANCELLATION_REASON_LABELS,
  formatShiftDate,
  formatShiftTimeRange,
  localDate,
} from "@/lib/domain/shifts";

function exceptionLabel(type: string): string {
  return (ATTENDANCE_EXCEPTION_LABELS as Record<string, string>)[type] ?? type;
}

export const metadata: Metadata = { title: "My shifts" };

/** The worker's own assignments at one agency. Nobody else's are ever shown. */
export default async function MyShiftsPage({
  params,
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

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          {organisation.name}
        </Link>
        <h1 className="text-2xl font-semibold">My shifts</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Shifts {organisation.name} has assigned to you. Times are in the facility&apos;s timezone.
          Accept to confirm you will work the shift, or decline if you cannot.
        </p>
      </header>

      <section aria-labelledby="my-attendance-heading" className="flex flex-col gap-3">
        <h2 id="my-attendance-heading" className="text-lg font-semibold">
          Attendance
        </h2>
        {attendance.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accepted shifts around today.</p>
        ) : (
          <ul aria-label="My attendance" className="flex flex-col gap-3">
            {attendance.map((item) => (
              <li
                key={item.assignmentId}
                aria-label={`Attendance: ${item.facilityName} ${formatShiftDate(item)}`}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{item.facilityName}</span>
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
                <p className="text-sm text-muted-foreground">
                  {item.locationName} · Clocked in{" "}
                  {formatLocalClockTime(item.clockInAt, item.timezone)} · Clocked out{" "}
                  {formatLocalClockTime(item.clockOutAt, item.timezone)}
                </p>
                {item.canClockIn ? (
                  <ClockControl
                    organisationId={organisationId}
                    assignmentId={item.assignmentId}
                    kind="in"
                    locationRequired={item.locationRequired}
                    facilityName={item.facilityName}
                  />
                ) : item.canClockOut ? (
                  <ClockControl
                    organisationId={organisationId}
                    assignmentId={item.assignmentId}
                    kind="out"
                    locationRequired={item.locationRequired}
                    facilityName={item.facilityName}
                  />
                ) : item.clockState === "not_started" && item.shiftStatus === "open" ? (
                  <p className="text-sm text-muted-foreground">
                    Clock-in opens at {formatLocalClockTime(item.earliestClockInAt, item.timezone)}.
                  </p>
                ) : null}
                {item.exceptions.length > 0 ? (
                  <ul aria-label="Attendance notes" className="flex flex-wrap gap-1">
                    {item.exceptions.map((exception, index) => (
                      <li key={`${exception.type}-${index}`}>
                        <Badge
                          tone={
                            exception.status === "open" || exception.status === "under_review"
                              ? "warning"
                              : "neutral"
                          }
                        >
                          {exceptionLabel(exception.type)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.corrections.length > 0 ? (
                  <ul aria-label="My correction requests" className="flex flex-col gap-1 text-sm">
                    {item.corrections.map((correction) => (
                      <li key={correction.id}>
                        {correction.eventType === "clock_in" ? "Clock-in" : "Clock-out"} at{" "}
                        {formatLocalClockTime(correction.requestedTime, item.timezone)}:{" "}
                        <span className="font-medium">
                          {CORRECTION_STATUS_LABELS[correction.status]}
                        </span>
                        {correction.resolution && correction.status === "rejected"
                          ? ` (${CORRECTION_RESOLUTION_LABELS[correction.resolution]})`
                          : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <details className="text-sm">
                  <summary className="cursor-pointer text-primary">
                    Request a time correction
                  </summary>
                  <div className="mt-3">
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
        <h2 id="my-offers-heading" className="text-lg font-semibold">
          Offers
        </h2>
        {offers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No shift offers right now.</p>
        ) : (
          <ul aria-label="Shift offers" className="flex flex-col gap-3">
            {offers.map((offer) => (
              <li
                key={offer.id}
                aria-label={`Offer: ${offer.facilityName} ${formatShiftDate(offer)}`}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
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
        <h2 id="my-shifts-heading" className="text-lg font-semibold">
          Assignments
        </h2>
        {assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">You have no assignments yet.</p>
        ) : (
          <ul aria-label="My assignments" className="flex flex-col gap-3">
            {assignments.map((assignment) => (
              <li
                key={assignment.id}
                aria-label={`${assignment.facilityName} ${formatShiftDate(assignment)}`}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
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
