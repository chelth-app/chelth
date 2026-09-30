import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { Badge } from "@/components/ui/badge";
import { AttendanceStateBadge, listFacilityShiftAttendance } from "@/features/attendance";
import { ReadinessBadge } from "@/features/compliance";
import { loadOrganisationPage, requireCapabilityOrNotFound } from "@/features/organisations";
import {
  AssignmentStatusBadge,
  FillBadge,
  listFacilityShiftAssignments,
  listFacilityShifts,
  shiftIdSchema,
  ShiftStatusBadge,
  withdrawFacilityRequestAction,
} from "@/features/shifts";
import { CAPABILITIES } from "@/lib/authz";
import { formatLocalClockTime, GEOFENCE_RESULT_LABELS } from "@/lib/domain/attendance";
import {
  formatShiftDate,
  formatShiftTimeRange,
  hasStarted,
  SHIFT_CANCELLATION_REASON_LABELS,
} from "@/lib/domain/shifts";

export const metadata: Metadata = { title: "Staffing request" };

export default async function StaffingRequestPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/staffing-requests/[shiftId]">) {
  const { organisationId: rawOrganisationId, shiftId: rawShiftId } = await params;
  const context = await loadOrganisationPage(rawOrganisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.SHIFT_VIEW);
  const parsedShiftId = shiftIdSchema.safeParse(rawShiftId);
  if (!parsedShiftId.success) notFound();
  const { organisationId, organisation, can } = context;
  if (organisation.type !== "facility") notFound();

  const [shift] = await listFacilityShifts(organisationId, parsedShiftId.data);
  if (!shift) notFound();
  // Audited read of the narrow "who is coming" projection.
  const workers = shift.status === "open" ? await listFacilityShiftAssignments(shift.id) : [];
  // Attendance is shown once the shift has begun (narrow, audited projection).
  const attendance =
    (shift.status === "open" || shift.status === "completed") &&
    hasStarted(shift) &&
    can(CAPABILITIES.ATTENDANCE_VIEW) === "granted"
      ? await listFacilityShiftAttendance(shift.id)
      : [];

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}/staffing-requests`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          Staffing requests · {organisation.name}
        </Link>
        <h1 className="text-2xl font-semibold">
          {shift.disciplineName} · {formatShiftDate(shift)}
        </h1>
        <div className="flex flex-wrap gap-2">
          <ShiftStatusBadge status={shift.status} />
          {shift.status === "open" ? (
            <FillBadge
              fillState={shift.fillState}
              activeCount={shift.activeCount}
              requestedHeadcount={shift.requestedHeadcount}
            />
          ) : null}
        </div>
      </header>

      <section aria-labelledby="request-details-heading" className="flex flex-col gap-3">
        <h2 id="request-details-heading" className="text-lg font-semibold">
          Details
        </h2>
        <dl className="grid max-w-2xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Agency</dt>
          <dd>{shift.agencyName}</dd>
          <dt className="text-muted-foreground">Location</dt>
          <dd>{shift.locationName}</dd>
          <dt className="text-muted-foreground">Time</dt>
          <dd>{formatShiftTimeRange(shift)}</dd>
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
        {shift.status === "submitted" &&
        shift.source === "facility" &&
        can(CAPABILITIES.SHIFT_REQUEST) === "granted" ? (
          <div>
            <InlineActionForm
              action={withdrawFacilityRequestAction}
              fields={{ organisationId, shiftId: shift.id }}
              label="Withdraw request"
            />
          </div>
        ) : null}
      </section>

      {shift.status === "open" ? (
        <section aria-labelledby="coming-heading" className="flex flex-col gap-3">
          <h2 id="coming-heading" className="text-lg font-semibold">
            Who is coming
          </h2>
          {workers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No workers assigned yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {workers.map((worker) => (
                <li
                  key={worker.assignmentId}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3"
                >
                  <span className="font-medium">{worker.displayName ?? "Worker"}</span>
                  <span className="text-sm text-muted-foreground">{worker.disciplineName}</span>
                  <AssignmentStatusBadge status={worker.status} />
                  <ReadinessBadge status={worker.readiness} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {attendance.length > 0 ? (
        <section aria-labelledby="facility-attendance-heading" className="flex flex-col gap-3">
          <h2 id="facility-attendance-heading" className="text-lg font-semibold">
            Attendance
          </h2>
          <div
            role="region"
            aria-label="Attendance for this request"
            tabIndex={0}
            className="overflow-x-auto rounded-lg border border-border bg-surface"
          >
            <table className="w-full min-w-[560px] text-left text-sm">
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
                        needsReview={row.hasOpenException}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {formatLocalClockTime(row.clockInAt, shift.timezone)}
                      {row.clockInLocation && row.clockInLocation !== "not_required" ? (
                        <div>
                          <Badge tone="neutral">
                            {GEOFENCE_RESULT_LABELS[row.clockInLocation]}
                          </Badge>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {formatLocalClockTime(row.clockOutAt, shift.timezone)}
                      {row.clockOutLocation && row.clockOutLocation !== "not_required" ? (
                        <div>
                          <Badge tone="neutral">
                            {GEOFENCE_RESULT_LABELS[row.clockOutLocation]}
                          </Badge>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
