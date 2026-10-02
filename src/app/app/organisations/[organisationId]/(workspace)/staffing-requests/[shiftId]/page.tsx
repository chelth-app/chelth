import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Panel } from "@/components/ui/panel";

import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { InlineActionForm } from "@/components/forms/inline-action-form";
import { EmptyState } from "@/components/ui/empty-state";
import { KeyValueList } from "@/components/ui/key-value-list";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
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
      <PageHeader
        title={`${shift.disciplineName} · ${formatShiftDate(shift)}`}
        back={
          <Link
            href={`/app/organisations/${organisationId}/staffing-requests`}
            className="text-primary underline underline-offset-4"
          >
            Staffing requests · {organisation.name}
          </Link>
        }
        description={
          <p className="text-sm">
            {shift.agencyName} · {shift.locationName}
          </p>
        }
        meta={
          <>
            <ShiftStatusBadge status={shift.status} />
            {shift.status === "open" ? (
              <FillBadge
                fillState={shift.fillState}
                activeCount={shift.activeCount}
                requestedHeadcount={shift.requestedHeadcount}
              />
            ) : null}
            {shift.relationshipStatus !== "active" ? (
              <StatusChip tone="warning">Agency relationship not active</StatusChip>
            ) : null}
          </>
        }
      />

      <Panel titleId="request-details-heading" title={<>Details</>}>
        <KeyValueList
          className="max-w-2xl"
          items={[
            { label: "Agency", value: shift.agencyName },
            { label: "Location", value: shift.locationName },
            { label: "Time", value: formatShiftTimeRange(shift) },
            { label: "Timezone", value: shift.timezone },
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
      </Panel>

      {shift.status === "open" ? (
        <Panel titleId="coming-heading" title={<>Who is coming</>}>
          {workers.length === 0 ? (
            <EmptyState headingLevel={3} title="No workers assigned yet." />
          ) : (
            <DataTableRegion aria-label="Workers coming">
              <DataTable className="min-w-[32rem]">
                <DataTableHead>
                  <tr>
                    <DataTableHeaderCell>Worker</DataTableHeaderCell>
                    <DataTableHeaderCell>Discipline</DataTableHeaderCell>
                    <DataTableHeaderCell>Assignment</DataTableHeaderCell>
                    <DataTableHeaderCell>Readiness</DataTableHeaderCell>
                  </tr>
                </DataTableHead>
                <tbody>
                  {workers.map((worker) => (
                    <DataTableRow key={worker.assignmentId}>
                      <DataTableCell className="font-medium">
                        {worker.displayName ?? "Worker"}
                      </DataTableCell>
                      <DataTableCell>{worker.disciplineName}</DataTableCell>
                      <DataTableCell>
                        <AssignmentStatusBadge status={worker.status} />
                      </DataTableCell>
                      <DataTableCell>
                        <ReadinessBadge status={worker.readiness} />
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </tbody>
              </DataTable>
            </DataTableRegion>
          )}
        </Panel>
      ) : null}

      {attendance.length > 0 ? (
        <Panel titleId="facility-attendance-heading" title={<>Attendance</>}>
          <DataTableRegion aria-label="Attendance for this request">
            <DataTable className="min-w-[560px]">
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Worker</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Clock in</DataTableHeaderCell>
                  <DataTableHeaderCell>Clock out</DataTableHeaderCell>
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
                        needsReview={row.hasOpenException}
                      />
                    </DataTableCell>
                    <DataTableCell>
                      {formatLocalClockTime(row.clockInAt, shift.timezone)}
                      {row.clockInLocation && row.clockInLocation !== "not_required" ? (
                        <div>
                          <StatusChip tone="neutral">
                            {GEOFENCE_RESULT_LABELS[row.clockInLocation]}
                          </StatusChip>
                        </div>
                      ) : null}
                    </DataTableCell>
                    <DataTableCell>
                      {formatLocalClockTime(row.clockOutAt, shift.timezone)}
                      {row.clockOutLocation && row.clockOutLocation !== "not_required" ? (
                        <div>
                          <StatusChip tone="neutral">
                            {GEOFENCE_RESULT_LABELS[row.clockOutLocation]}
                          </StatusChip>
                        </div>
                      ) : null}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </tbody>
            </DataTable>
          </DataTableRegion>
        </Panel>
      ) : null}
    </>
  );
}
