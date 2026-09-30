import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { Badge } from "@/components/ui/badge";
import {
  AttendanceStateBadge,
  CorrectionReviewForms,
  listAgencyAttendance,
  listPendingCorrections,
} from "@/features/attendance";
import { ReadinessBadge } from "@/features/compliance";
import { loadOrganisationPage, requireCapabilityOrNotFound } from "@/features/organisations";
import {
  AssignmentStatusBadge,
  AssignWorkerButton,
  CancelAssignmentForm,
  cancelOfferAction,
  CancelShiftForm,
  completeShiftAction,
  explainBlockReasons,
  FillBadge,
  getAgencyShift,
  listAssignmentReadiness,
  listCredentialTypeNames,
  listShiftAssignments,
  listAssignmentIssues,
  listShiftCandidatesPage,
  listShiftDecisions,
  listShiftNotes,
  listShiftOffers,
  OfferShiftForm,
  OfferStatusBadge,
  openShiftAction,
  recheckReadinessAction,
  ShiftDetailsForm,
  shiftIdSchema,
  ShiftNoteForm,
  ShiftStatusBadge,
} from "@/features/shifts";
import { CAPABILITIES } from "@/lib/authz";
import {
  ATTENDANCE_EXCEPTION_LABELS,
  CORRECTION_REASON_LABELS,
  formatLocalClockTime,
  GEOFENCE_RESULT_LABELS,
} from "@/lib/domain/attendance";
import {
  ASSIGNMENT_BLOCK_REASON_LABELS,
  ASSIGNMENT_CANCELLATION_REASON_LABELS,
  ASSIGNMENT_ISSUE_SEVERITY_LABELS,
  ASSIGNMENT_ISSUE_TYPE_LABELS,
  deriveFillState,
  formatShiftDate,
  formatShiftTimeRange,
  hasEnded,
  hasStarted,
  isActiveAssignment,
  SHIFT_CANCELLATION_REASON_LABELS,
  SHIFT_OFFER_CLOSE_REASON_LABELS,
  SHIFT_SOURCE_LABELS,
} from "@/lib/domain/shifts";

export const metadata: Metadata = { title: "Shift" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default async function ShiftPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/shifts/[shiftId]">) {
  const { organisationId: rawOrganisationId, shiftId: rawShiftId } = await params;
  const context = await loadOrganisationPage(rawOrganisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.SHIFT_VIEW);
  const parsedShiftId = shiftIdSchema.safeParse(rawShiftId);
  if (!parsedShiftId.success) notFound();
  const { organisationId, organisation, can } = context;
  const shift = await getAgencyShift(organisationId, parsedShiftId.data);
  if (!shift) notFound();

  const canManageShift = can(CAPABILITIES.SHIFT_MANAGE) === "granted";
  const canViewAssignments = can(CAPABILITIES.ASSIGNMENT_VIEW) === "granted";
  const canAssign =
    can(CAPABILITIES.ASSIGNMENT_MANAGE) === "granted" &&
    can(CAPABILITIES.COMPLIANCE_VIEW) === "granted";
  const canSeeReadiness = canViewAssignments && can(CAPABILITIES.COMPLIANCE_VIEW) === "granted";
  const ended = hasEnded(shift);
  const isOpen = shift.status === "open" && !ended;
  const relationshipActive = shift.relationshipStatus === "active";

  const canStaff = canAssign && isOpen && relationshipActive;
  const canOffer = canStaff && !hasStarted(shift);
  const [
    assignments,
    readiness,
    eligible,
    allCandidates,
    offers,
    issues,
    decisions,
    notes,
    typeNames,
  ] = await Promise.all([
    canViewAssignments ? listShiftAssignments(shift.id) : Promise.resolve([]),
    canSeeReadiness ? listAssignmentReadiness(organisationId, shift.id) : Promise.resolve([]),
    canStaff ? listShiftCandidatesPage(shift.id, false) : Promise.resolve([]),
    canStaff ? listShiftCandidatesPage(shift.id, true) : Promise.resolve([]),
    canViewAssignments ? listShiftOffers(shift.id) : Promise.resolve([]),
    canSeeReadiness ? listAssignmentIssues(organisationId, shift.id) : Promise.resolve([]),
    canViewAssignments ? listShiftDecisions(shift.id) : Promise.resolve([]),
    listShiftNotes(shift.id),
    listCredentialTypeNames(),
  ]);
  const canViewAttendance = can(CAPABILITIES.ATTENDANCE_VIEW) === "granted";
  const attendance = canViewAttendance
    ? await listAgencyAttendance(organisationId, { shiftId: shift.id })
    : [];
  const attendanceCorrections =
    canViewAttendance && attendance.length > 0
      ? await listPendingCorrections(
          organisationId,
          attendance.map((row) => row.assignmentId),
        )
      : [];
  const attendanceByAssignment = new Map(attendance.map((row) => [row.assignmentId, row]));
  const canReviewAttendance = can(CAPABILITIES.ATTENDANCE_REVIEW) === "granted";
  const candidates = allCandidates;
  const issuesByAssignment = new Map<string, typeof issues>();
  for (const issue of issues) {
    issuesByAssignment.set(issue.assignmentId, [
      ...(issuesByAssignment.get(issue.assignmentId) ?? []),
      issue,
    ]);
  }
  const readinessById = new Map(readiness.map((row) => [row.assignmentId, row]));
  const active = assignments.filter((assignment) => isActiveAssignment(assignment.status));
  const history = assignments.filter((assignment) => !isActiveAssignment(assignment.status));
  const unavailable = candidates.filter((candidate) => !candidate.assignable);
  const offerable = eligible.filter((candidate) => !candidate.hasLiveOffer);
  const workerName = new Map(
    assignments.map((assignment) => [assignment.workerId, assignment.workerName]),
  );
  for (const candidate of candidates)
    workerName.set(candidate.workerId, candidate.displayName ?? "Worker");

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}/shifts`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          Shifts · {organisation.name}
        </Link>
        <h1 className="text-2xl font-semibold">
          {shift.facilityName} · {shift.disciplineName}
        </h1>
        <div className="flex flex-wrap gap-2">
          <ShiftStatusBadge status={shift.status} />
          {canViewAssignments && shift.status === "open" ? (
            <FillBadge
              fillState={deriveFillState(active.length, shift.requestedHeadcount)}
              activeCount={active.length}
              requestedHeadcount={shift.requestedHeadcount}
            />
          ) : null}
          <Badge tone="neutral">{SHIFT_SOURCE_LABELS[shift.source]}</Badge>
          {!relationshipActive ? <Badge tone="warning">Relationship not active</Badge> : null}
        </div>
      </header>

      <section aria-labelledby="shift-details-heading" className="flex flex-col gap-3">
        <h2 id="shift-details-heading" className="text-lg font-semibold">
          Details
        </h2>
        <dl className="grid max-w-2xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Date</dt>
          <dd>{formatShiftDate(shift)}</dd>
          <dt className="text-muted-foreground">Time</dt>
          <dd>{formatShiftTimeRange(shift)}</dd>
          <dt className="text-muted-foreground">Timezone</dt>
          <dd>{shift.timezone}</dd>
          <dt className="text-muted-foreground">Location</dt>
          <dd>{shift.locationName}</dd>
          <dt className="text-muted-foreground">Workers needed</dt>
          <dd>{shift.requestedHeadcount}</dd>
          {shift.externalReference ? (
            <>
              <dt className="text-muted-foreground">Reference</dt>
              <dd>{shift.externalReference}</dd>
            </>
          ) : null}
          {shift.instructions ? (
            <>
              <dt className="text-muted-foreground">Instructions</dt>
              <dd className="whitespace-pre-line">{shift.instructions}</dd>
            </>
          ) : null}
          {shift.cancellationReason ? (
            <>
              <dt className="text-muted-foreground">Cancelled</dt>
              <dd>{SHIFT_CANCELLATION_REASON_LABELS[shift.cancellationReason]}</dd>
            </>
          ) : null}
        </dl>
        {canManageShift ? (
          <div className="flex flex-wrap gap-2">
            {(shift.status === "draft" || shift.status === "submitted") && relationshipActive ? (
              <InlineActionForm
                action={openShiftAction}
                fields={{ organisationId, shiftId: shift.id }}
                label={shift.status === "submitted" ? "Accept and open request" : "Open shift"}
                variant="primary"
              />
            ) : null}
            {shift.status === "open" && ended ? (
              <InlineActionForm
                action={completeShiftAction}
                fields={{ organisationId, shiftId: shift.id }}
                label="Mark completed"
              />
            ) : null}
          </div>
        ) : null}
      </section>

      {canViewAssignments ? (
        <section aria-labelledby="assignments-heading" className="flex flex-col gap-3">
          <h2 id="assignments-heading" className="text-lg font-semibold">
            Assigned workers
          </h2>
          {canAssign && active.length > 0 ? (
            <div>
              <InlineActionForm
                action={recheckReadinessAction}
                fields={{ organisationId, shiftId: shift.id }}
                label="Re-check readiness"
              />
            </div>
          ) : null}
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one is assigned yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {active.map((assignment) => {
                const live = readinessById.get(assignment.id);
                return (
                  <li
                    key={assignment.id}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{assignment.workerName}</span>
                      <AssignmentStatusBadge status={assignment.status} />
                      {live ? (
                        live.eligible ? (
                          <ReadinessBadge status="ready" />
                        ) : (
                          <Badge tone="danger">No longer eligible</Badge>
                        )
                      ) : null}
                      {(issuesByAssignment.get(assignment.id) ?? []).map((issue) => (
                        <Badge
                          key={issue.id}
                          tone={issue.severity === "urgent" ? "danger" : "warning"}
                        >
                          {ASSIGNMENT_ISSUE_SEVERITY_LABELS[issue.severity]}:{" "}
                          {ASSIGNMENT_ISSUE_TYPE_LABELS[issue.issueType]}
                        </Badge>
                      ))}
                    </div>
                    {live && !live.eligible ? (
                      <ul className="list-disc pl-5 text-sm text-danger">
                        {!live.relationshipActive ? (
                          <li>The facility relationship is not active</li>
                        ) : null}
                        {explainBlockReasons(live.blockReasons, live.findings, typeNames).map(
                          (line) => (
                            <li key={line}>{line}</li>
                          ),
                        )}
                      </ul>
                    ) : null}
                    {can(CAPABILITIES.ASSIGNMENT_MANAGE) === "granted" ? (
                      <CancelAssignmentForm
                        organisationId={organisationId}
                        shiftId={shift.id}
                        assignmentId={assignment.id}
                        workerName={assignment.workerName}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {history.length > 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer">Earlier assignments ({history.length})</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {history.map((assignment) => (
                  <li key={assignment.id} className="flex flex-wrap items-center gap-2">
                    {assignment.workerName} <AssignmentStatusBadge status={assignment.status} />
                    {assignment.cancellationReason
                      ? ASSIGNMENT_CANCELLATION_REASON_LABELS[assignment.cancellationReason]
                      : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      {canStaff ? (
        <section aria-labelledby="assign-heading" className="flex flex-col gap-3">
          <h2 id="assign-heading" className="text-lg font-semibold">
            Assign a worker
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Workers who hold this discipline, are compliant for {shift.facilityName} on the shift
            date and have no scheduling conflict. Chelth re-checks every assignment when you submit.
          </p>
          {eligible.length === 0 ? (
            <p className="text-sm text-muted-foreground">No eligible workers right now.</p>
          ) : (
            <ul aria-label="Eligible workers" className="flex flex-col gap-2">
              {eligible.map((candidate) => (
                <li
                  key={candidate.workerId}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border bg-surface p-3"
                >
                  <span className="flex items-center gap-2 font-medium">
                    {candidate.displayName ?? "Worker"}{" "}
                    <ReadinessBadge status={candidate.readiness} />
                  </span>
                  <AssignWorkerButton
                    organisationId={organisationId}
                    shiftId={shift.id}
                    workerId={candidate.workerId}
                    workerName={candidate.displayName ?? "Worker"}
                    label="Assign"
                  />
                </li>
              ))}
            </ul>
          )}
          {unavailable.length > 0 ? (
            <details className="flex flex-col gap-2">
              <summary className="cursor-pointer text-sm">
                Unavailable workers ({unavailable.length})
              </summary>
              <ul aria-label="Unavailable workers" className="mt-2 flex flex-col gap-2">
                {unavailable.map((candidate) => (
                  <li
                    key={candidate.workerId}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="font-medium">{candidate.displayName ?? "Worker"}</span>
                      <AssignWorkerButton
                        organisationId={organisationId}
                        shiftId={shift.id}
                        workerId={candidate.workerId}
                        workerName={candidate.displayName ?? "Worker"}
                        label="Try to assign"
                        variant="outline"
                      />
                    </div>
                    <ul className="list-disc pl-5 text-sm text-muted-foreground">
                      {explainBlockReasons(
                        candidate.blockReasons,
                        candidate.findings,
                        typeNames,
                      ).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      {canViewAttendance && attendance.length > 0 ? (
        <section aria-labelledby="attendance-heading" className="flex flex-col gap-3">
          <h2 id="attendance-heading" className="text-lg font-semibold">
            Attendance
          </h2>
          <div
            role="region"
            aria-label="Attendance for this shift"
            tabIndex={0}
            className="overflow-x-auto rounded-lg border border-border bg-surface"
          >
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Worker
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
                    Exceptions
                  </th>
                </tr>
              </thead>
              <tbody>
                {attendance.map((row) => (
                  <tr
                    key={row.assignmentId}
                    className="border-b border-border align-top last:border-0"
                  >
                    <td className="px-3 py-2 font-medium">{row.workerName ?? "Worker"}</td>
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {attendanceCorrections.length > 0 ? (
            <ul aria-label="Attendance corrections for this shift" className="flex flex-col gap-3">
              {attendanceCorrections.map((correction) => {
                const row = attendanceByAssignment.get(correction.assignmentId);
                const worker = row?.workerName ?? "Worker";
                return (
                  <li
                    key={correction.id}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
                  >
                    <p>
                      <span className="font-medium">{worker}</span> asks to set the{" "}
                      {correction.eventType === "clock_in" ? "clock-in" : "clock-out"} time to{" "}
                      {formatLocalClockTime(correction.requestedTime, shift.timezone)} ·{" "}
                      {CORRECTION_REASON_LABELS[correction.reason]}
                    </p>
                    {canReviewAttendance ? (
                      <CorrectionReviewForms
                        organisationId={organisationId}
                        correctionId={correction.id}
                        workerName={worker}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}

      {canOffer ? (
        <section aria-labelledby="offer-heading" className="flex flex-col gap-3">
          <h2 id="offer-heading" className="text-lg font-semibold">
            Offer shift
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Ask eligible workers to take this shift. Offers do not hold a place: the first workers
            to accept (and still pass every check) are assigned, and the remaining offers close when
            the shift is full.
          </p>
          {offerable.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No eligible workers without an open offer.
            </p>
          ) : (
            <OfferShiftForm
              organisationId={organisationId}
              shiftId={shift.id}
              candidates={offerable.map((candidate) => ({
                workerId: candidate.workerId,
                name: candidate.displayName ?? "Worker",
              }))}
            />
          )}
        </section>
      ) : null}

      {canViewAssignments && offers.length > 0 ? (
        <section aria-labelledby="offers-heading" className="flex flex-col gap-3">
          <h2 id="offers-heading" className="text-lg font-semibold">
            Offers
          </h2>
          <ul aria-label="Offers" className="flex flex-col gap-2">
            {offers.map((offer) => (
              <li
                key={offer.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{offer.workerName}</span>
                  <OfferStatusBadge status={offer.status} />
                  {offer.closeReason ? (
                    <span className="text-muted-foreground">
                      {SHIFT_OFFER_CLOSE_REASON_LABELS[offer.closeReason]}
                    </span>
                  ) : null}
                  {offer.status === "offered" ? (
                    <span className="text-muted-foreground">
                      until {dateTime.format(new Date(offer.expiresAt))}
                    </span>
                  ) : null}
                </span>
                {offer.status === "offered" && can(CAPABILITIES.ASSIGNMENT_MANAGE) === "granted" ? (
                  <InlineActionForm
                    action={cancelOfferAction}
                    fields={{ organisationId, shiftId: shift.id, offerId: offer.id }}
                    label="Withdraw"
                    accessibleLabel={`Withdraw offer to ${offer.workerName}`}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canViewAssignments && decisions.length > 0 ? (
        <section aria-labelledby="decisions-heading" className="flex flex-col gap-3">
          <h2 id="decisions-heading" className="text-lg font-semibold">
            Assignment decisions
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {decisions.map((decision) => (
              <li key={decision.id}>
                {dateTime.format(new Date(decision.decidedAt))} ·{" "}
                {workerName.get(decision.workerId) ?? "Worker"} ·{" "}
                {decision.outcome === "allowed"
                  ? "Allowed"
                  : `Refused — ${decision.blockReasons.map((reason) => ASSIGNMENT_BLOCK_REASON_LABELS[reason]).join("; ")}`}
                {" · "}evaluated for {decision.evaluationDates.join(", ")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canManageShift &&
      (shift.status === "open" || shift.status === "draft" || shift.status === "submitted") ? (
        <section aria-labelledby="manage-shift-heading" className="flex flex-col gap-4">
          <h2 id="manage-shift-heading" className="text-lg font-semibold">
            Manage shift
          </h2>
          <ShiftDetailsForm
            organisationId={organisationId}
            shiftId={shift.id}
            requestedHeadcount={shift.requestedHeadcount}
            instructions={shift.instructions}
            externalReference={shift.externalReference}
          />
          <CancelShiftForm organisationId={organisationId} shiftId={shift.id} />
        </section>
      ) : null}

      <section aria-labelledby="notes-heading" className="flex flex-col gap-3">
        <h2 id="notes-heading" className="text-lg font-semibold">
          Internal notes
        </h2>
        <p className="text-sm text-muted-foreground">
          Visible to your agency only — never to the facility or workers.
        </p>
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {notes.map((note) => (
              <li key={note.id} className="rounded-md border border-border bg-surface p-3">
                <p className="whitespace-pre-line">{note.body}</p>
                <p className="text-xs text-muted-foreground">
                  {dateTime.format(new Date(note.createdAt))}
                </p>
              </li>
            ))}
          </ul>
        )}
        {canManageShift ? (
          <ShiftNoteForm organisationId={organisationId} shiftId={shift.id} />
        ) : null}
      </section>
    </>
  );
}
