import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { InitialsAvatar, REF_TABLE, REF_TEXT } from "@/components/reference/locked-reference";
import {
  RECORD_ROW,
  RECORD_ROW_META,
  RECORD_ROW_TITLE,
  RecordList,
  RecordPage,
} from "@/components/reference/record-page";
import { DataTableRegion } from "@/components/ui/data-table";
import { KeyValueList } from "@/components/ui/key-value-list";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SectionTabs } from "@/components/ui/section-tabs";
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
import { cn } from "@/lib/utils/cn";

import { LockedEmpty } from "../../(finance)/_components/finance-locked";

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

  const canWithdraw =
    shift.status === "submitted" &&
    shift.source === "facility" &&
    can(CAPABILITIES.SHIFT_REQUEST) === "granted";

  return (
    // Canonical record page (P0-E8-QA-F1): the Facility / Shift record arrangement.
    <RecordPage>
      <PageHeader
        variant="reference"
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
          <p>
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

      <SectionTabs
        label="Request sections"
        tabs={[
          { label: "Details", href: "#request-details-heading" as Route, current: false },
          ...(shift.status === "open"
            ? [{ label: "Who is coming", href: "#coming-heading" as Route, current: false }]
            : []),
          ...(attendance.length > 0
            ? [
                {
                  label: "Attendance",
                  href: "#facility-attendance-heading" as Route,
                  current: false,
                },
              ]
            : []),
        ]}
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
        {canWithdraw ? (
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
            <LockedEmpty
              icon="workforce"
              title="No workers assigned yet."
              note="Workers your agency assigns to this request appear here."
            />
          ) : (
            <RecordList label="Workers coming">
              {workers.map((worker) => (
                <li key={worker.assignmentId} className={RECORD_ROW}>
                  <InitialsAvatar name={worker.displayName} size={36} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={RECORD_ROW_TITLE}>{worker.displayName ?? "Worker"}</span>
                    <span className={RECORD_ROW_META}>{worker.disciplineName}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <AssignmentStatusBadge status={worker.status} />
                    <ReadinessBadge status={worker.readiness} />
                  </span>
                </li>
              ))}
            </RecordList>
          )}
        </Panel>
      ) : null}

      {attendance.length > 0 ? (
        <Panel titleId="facility-attendance-heading" title={<>Attendance</>}>
          <DataTableRegion
            aria-label="Attendance for this request"
            className="rounded-none border-0 bg-transparent"
          >
            <table className={cn(REF_TABLE, "min-w-[560px]")}>
              <thead className={REF_TEXT.tableHead}>
                <tr>
                  <th scope="col">Worker</th>
                  <th scope="col">Status</th>
                  <th scope="col">Clock in</th>
                  <th scope="col">Clock out</th>
                </tr>
              </thead>
              <tbody className="text-[13.5px] leading-5 text-slate-600">
                {attendance.map((row) => (
                  <tr key={row.assignmentId}>
                    <td className="py-2.5">
                      <span className="flex items-center gap-2.5">
                        <InitialsAvatar name={row.workerName} />
                        <span className="font-medium text-chelth-navy">
                          {row.workerName ?? "Worker"}
                        </span>
                      </span>
                    </td>
                    <td className="py-2.5">
                      <AttendanceStateBadge
                        clockState={row.clockState}
                        needsReview={row.hasOpenException}
                      />
                    </td>
                    <td className="py-2.5">
                      <span className="flex flex-col items-start gap-1">
                        {formatLocalClockTime(row.clockInAt, shift.timezone)}
                        {row.clockInLocation && row.clockInLocation !== "not_required" ? (
                          <StatusChip tone="neutral">
                            {GEOFENCE_RESULT_LABELS[row.clockInLocation]}
                          </StatusChip>
                        ) : null}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <span className="flex flex-col items-start gap-1">
                        {formatLocalClockTime(row.clockOutAt, shift.timezone)}
                        {row.clockOutLocation && row.clockOutLocation !== "not_required" ? (
                          <StatusChip tone="neutral">
                            {GEOFENCE_RESULT_LABELS[row.clockOutLocation]}
                          </StatusChip>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTableRegion>
        </Panel>
      ) : null}
    </RecordPage>
  );
}
