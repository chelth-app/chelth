import type { Metadata, Route } from "next";
import Link from "next/link";

import { Panel } from "@/components/ui/panel";
import { notFound } from "next/navigation";

import { ActivityTimeline } from "@/components/ui/activity-timeline";
import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { KeyValueList } from "@/components/ui/key-value-list";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTabs } from "@/components/ui/section-tabs";
import { StatusChip } from "@/components/ui/status-chip";
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
import { ShiftClassificationForm } from "@/features/pricing";
import { CAPABILITIES } from "@/lib/authz";
import {
  ATTENDANCE_EXCEPTION_LABELS,
  CORRECTION_REASON_LABELS,
  describeCorrectionTarget,
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
  localDate,
  SHIFT_CANCELLATION_REASON_LABELS,
  SHIFT_OFFER_CLOSE_REASON_LABELS,
  SHIFT_SOURCE_LABELS,
} from "@/lib/domain/shifts";
import { SHIFT_CLASSIFICATION_LABELS } from "@/lib/domain/pricing";

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
      <PageHeader
        title={`${shift.facilityName} · ${shift.disciplineName}`}
        back={
          <Link
            href={`/app/organisations/${organisationId}/shifts`}
            className="text-primary underline underline-offset-4"
          >
            Shifts · {organisation.name}
          </Link>
        }
        description={
          <p>
            {formatShiftDate(shift)} · {shift.locationName}
          </p>
        }
        meta={
          <>
            <ShiftStatusBadge status={shift.status} />
            {canViewAssignments && shift.status === "open" ? (
              <FillBadge
                fillState={deriveFillState(active.length, shift.requestedHeadcount)}
                activeCount={active.length}
                requestedHeadcount={shift.requestedHeadcount}
              />
            ) : null}
            <Badge tone="neutral">{SHIFT_SOURCE_LABELS[shift.source]}</Badge>
            <Badge tone="neutral">{SHIFT_CLASSIFICATION_LABELS[shift.classification]} shift</Badge>
            {!relationshipActive ? (
              <StatusChip tone="warning">Relationship not active</StatusChip>
            ) : null}
          </>
        }
      />

      <SectionTabs
        label="Shift sections"
        tabs={[
          { label: "Details", href: "#shift-details-heading" as Route, current: false },
          ...(canViewAssignments
            ? [{ label: "Assigned workers", href: "#assignments-heading" as Route, current: false }]
            : []),
          ...(canStaff
            ? [{ label: "Assign", href: "#assign-heading" as Route, current: false }]
            : []),
          ...(canViewAttendance && attendance.length > 0
            ? [{ label: "Attendance", href: "#attendance-heading" as Route, current: false }]
            : []),
          ...(canOffer || (canViewAssignments && offers.length > 0)
            ? [
                {
                  label: "Offers",
                  href: (canOffer ? "#offer-heading" : "#offers-heading") as Route,
                  current: false,
                },
              ]
            : []),
          ...(canViewAssignments && decisions.length > 0
            ? [{ label: "Decisions", href: "#decisions-heading" as Route, current: false }]
            : []),
          { label: "Notes", href: "#notes-heading" as Route, current: false },
        ]}
      />

      {canManageShift && (shift.status === "draft" || shift.status === "submitted") ? (
        <ShiftClassificationForm
          organisationId={organisationId}
          shiftId={shift.id}
          classification={shift.classification}
        />
      ) : null}

      <Panel titleId="shift-details-heading" title={<>Details</>}>
        <KeyValueList
          className="max-w-2xl"
          items={[
            { label: "Date", value: formatShiftDate(shift) },
            { label: "Time", value: formatShiftTimeRange(shift) },
            { label: "Timezone", value: shift.timezone },
            { label: "Location", value: shift.locationName },
            { label: "Workers needed", value: shift.requestedHeadcount },
            ...(shift.externalReference
              ? [{ label: "Reference", value: shift.externalReference }]
              : []),
            ...(shift.instructions
              ? [
                  {
                    label: "Instructions",
                    value: <span className="whitespace-pre-line">{shift.instructions}</span>,
                  },
                ]
              : []),
            ...(shift.cancellationReason
              ? [
                  {
                    label: "Cancelled",
                    value: SHIFT_CANCELLATION_REASON_LABELS[shift.cancellationReason],
                  },
                ]
              : []),
          ]}
        />
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
      </Panel>

      {canViewAssignments ? (
        <Panel titleId="assignments-heading" title={<>Assigned workers</>}>
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
                          <StatusChip tone="danger">No longer eligible</StatusChip>
                        )
                      ) : null}
                      {(issuesByAssignment.get(assignment.id) ?? []).map((issue) => (
                        <StatusChip
                          key={issue.id}
                          tone={issue.severity === "urgent" ? "danger" : "attention"}
                        >
                          {ASSIGNMENT_ISSUE_SEVERITY_LABELS[issue.severity]}:{" "}
                          {ASSIGNMENT_ISSUE_TYPE_LABELS[issue.issueType]}
                        </StatusChip>
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
        </Panel>
      ) : null}

      {canStaff ? (
        <Panel titleId="assign-heading" title={<>Assign a worker</>}>
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
        </Panel>
      ) : null}

      {canViewAttendance && attendance.length > 0 ? (
        <Panel titleId="attendance-heading" title={<>Attendance</>}>
          <DataTableRegion aria-label="Attendance for this shift">
            <DataTable className="min-w-[640px]">
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Worker</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Clock in</DataTableHeaderCell>
                  <DataTableHeaderCell>Clock out</DataTableHeaderCell>
                  <DataTableHeaderCell>Exceptions</DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                {attendance.map((row) => (
                  <DataTableRow key={row.assignmentId}>
                    <DataTableCell className="font-medium">
                      {row.workerName ?? "Worker"}
                    </DataTableCell>
                    <DataTableCell>
                      <AttendanceStateBadge
                        clockState={row.clockState}
                        needsReview={row.needsReview}
                      />
                    </DataTableCell>
                    <DataTableCell>
                      {formatLocalClockTime(row.clockInAt, row.timezone)}
                      {row.clockInLocation && row.clockInLocation !== "not_required" ? (
                        <div className="text-xs text-muted-foreground">
                          {GEOFENCE_RESULT_LABELS[row.clockInLocation]}
                        </div>
                      ) : null}
                    </DataTableCell>
                    <DataTableCell>
                      {formatLocalClockTime(row.clockOutAt, row.timezone)}
                      {row.clockOutLocation && row.clockOutLocation !== "not_required" ? (
                        <div className="text-xs text-muted-foreground">
                          {GEOFENCE_RESULT_LABELS[row.clockOutLocation]}
                        </div>
                      ) : null}
                    </DataTableCell>
                    <DataTableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.openExceptionTypes.map((type) => (
                          <StatusChip key={type} tone="attention">
                            {ATTENDANCE_EXCEPTION_LABELS[type]}
                          </StatusChip>
                        ))}
                      </div>
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </tbody>
            </DataTable>
          </DataTableRegion>
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
                      {describeCorrectionTarget(correction.eventType, correction.segment)} to{" "}
                      {formatLocalClockTime(correction.requestedTime, shift.timezone)} ·{" "}
                      {CORRECTION_REASON_LABELS[correction.reason]}
                    </p>
                    {canReviewAttendance ? (
                      <CorrectionReviewForms
                        organisationId={organisationId}
                        correctionId={correction.id}
                        workerName={worker}
                        timezone={shift.timezone}
                        defaultDate={localDate(correction.requestedTime, shift.timezone)}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Panel>
      ) : null}

      {canOffer ? (
        <Panel titleId="offer-heading" title={<>Offer shift</>}>
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
        </Panel>
      ) : null}

      {canViewAssignments && offers.length > 0 ? (
        <Panel titleId="offers-heading" title={<>Offers</>}>
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
        </Panel>
      ) : null}

      {canViewAssignments && decisions.length > 0 ? (
        <Panel titleId="decisions-heading" title={<>Assignment decisions</>}>
          <ActivityTimeline
            label="Assignment decisions"
            items={decisions.map((decision) => ({
              id: decision.id,
              tone: decision.outcome === "allowed" ? ("success" as const) : ("danger" as const),
              title:
                decision.outcome === "allowed"
                  ? `${workerName.get(decision.workerId) ?? "Worker"} · Allowed`
                  : `${workerName.get(decision.workerId) ?? "Worker"} · Refused — ${decision.blockReasons.map((reason) => ASSIGNMENT_BLOCK_REASON_LABELS[reason]).join("; ")}`,
              meta: `${dateTime.format(new Date(decision.decidedAt))} · evaluated for ${decision.evaluationDates.join(", ")}`,
            }))}
          />
        </Panel>
      ) : null}

      {canManageShift &&
      (shift.status === "open" || shift.status === "draft" || shift.status === "submitted") ? (
        <Panel titleId="manage-shift-heading" title={<>Manage shift</>}>
          <ShiftDetailsForm
            organisationId={organisationId}
            shiftId={shift.id}
            requestedHeadcount={shift.requestedHeadcount}
            instructions={shift.instructions}
            externalReference={shift.externalReference}
          />
          <CancelShiftForm organisationId={organisationId} shiftId={shift.id} />
        </Panel>
      ) : null}

      <Panel titleId="notes-heading" title={<>Internal notes</>}>
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
      </Panel>
    </>
  );
}
