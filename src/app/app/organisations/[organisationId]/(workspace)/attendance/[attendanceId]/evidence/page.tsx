import type { Metadata } from "next";
import Link from "next/link";

import { Panel } from "@/components/ui/panel";
import { notFound } from "next/navigation";
import { z } from "zod";

import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import {
  getAttendanceRecord,
  listAgencyAttendance,
  listEvidenceHolds,
  listLocationEvidence,
  PlaceHoldForm,
  ReleaseHoldForm,
} from "@/features/attendance";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";
import {
  ATTENDANCE_EVENT_LABELS,
  EVIDENCE_STATE_LABELS,
  GEOFENCE_RESULT_LABELS,
} from "@/lib/domain/attendance";
import { formatShiftDate } from "@/lib/domain/shifts";

export const metadata: Metadata = { title: "Location evidence" };

const idSchema = z.uuid();

function dateTime(instant: string | null, timezone: string): string {
  if (!instant) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(instant));
}

function metres(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} m`;
}

/**
 * Raw, device-reported location evidence for ONE attendance record.
 * attendance.location.view at AAL2 only; every view is audited by the
 * database. Never shown to facilities; never a live or continuous location.
 */
export default async function LocationEvidencePage({
  params,
}: PageProps<"/app/organisations/[organisationId]/attendance/[attendanceId]/evidence">) {
  const { organisationId: rawOrganisationId, attendanceId: rawAttendanceId } = await params;
  const context = await loadOrganisationPage(rawOrganisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.ATTENDANCE_LOCATION_VIEW);
  const { organisationId, organisation, can } = context;
  if (organisation.type !== "agency") notFound();
  const parsed = idSchema.safeParse(rawAttendanceId);
  if (!parsed.success) notFound();
  const returnTo = `/app/organisations/${organisationId}/attendance/${parsed.data}/evidence`;
  const recordPath = `/app/organisations/${organisationId}/attendance/${parsed.data}` as const;

  if (can(CAPABILITIES.ATTENDANCE_LOCATION_VIEW) !== "granted") {
    return (
      <>
        <header className="flex flex-col gap-2">
          <Link
            href={recordPath}
            className="w-fit text-sm text-primary underline underline-offset-4"
          >
            Attendance record
          </Link>
          <h1 className="text-2xl font-semibold">Location evidence</h1>
        </header>
        <StepUpNotice returnTo={returnTo}>
          Raw location evidence requires verification with your authenticator app.
        </StepUpNotice>
      </>
    );
  }

  const record = await getAttendanceRecord(organisationId, parsed.data);
  if (!record) notFound();
  const [rows, evidence, holds] = await Promise.all([
    listAgencyAttendance(organisationId, { shiftId: record.shiftId }),
    listLocationEvidence(record.attendanceId),
    listEvidenceHolds(record.attendanceId),
  ]);
  const row = rows.find((candidate) => candidate.assignmentId === record.assignmentId);
  if (!row) notFound();
  const activeHold = holds.find((hold) => hold.releasedAt === null);
  const retentionDays = evidence[0]?.retentionDays;

  return (
    <>
      <PageHeader
        title="Location evidence"
        back={
          <Link href={recordPath} className="text-primary underline underline-offset-4">
            Attendance record
          </Link>
        }
        description={
          <p className="text-sm">
            {row.workerName ?? "Worker"} · {row.facilityName} · {formatShiftDate(row)}
          </p>
        }
        meta={activeHold ? <StatusChip tone="warning">Legal hold active</StatusChip> : undefined}
      />

      <p
        role="note"
        className="max-w-3xl rounded-md border border-border bg-surface-muted p-3 text-sm"
      >
        Device-reported location, captured once at each clock action where this site checks
        location. It is evidence for review, not proof of presence: devices can report inaccurate or
        altered locations. Chelth never tracks workers continuously. This view is recorded in the
        audit log.
      </p>

      {evidence.length === 0 ? (
        <EmptyState
          title="No location evidence"
          description="This site did not check location for this record."
        />
      ) : (
        <DataTableRegion aria-label="Location evidence table">
          <DataTable className="min-w-[860px]">
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>Clock action</DataTableHeaderCell>
                <DataTableHeaderCell>Result</DataTableHeaderCell>
                <DataTableHeaderCell>Recorded (server)</DataTableHeaderCell>
                <DataTableHeaderCell>Captured (device)</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Accuracy</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Distance</DataTableHeaderCell>
                <DataTableHeaderCell numeric>Radius</DataTableHeaderCell>
                <DataTableHeaderCell>Coordinates</DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {evidence.map((item) => (
                <DataTableRow key={`${item.eventType}-${item.recordedAt}`}>
                  <DataTableCell className="font-medium">
                    {ATTENDANCE_EVENT_LABELS[item.eventType]}
                  </DataTableCell>
                  <DataTableCell>{GEOFENCE_RESULT_LABELS[item.result]}</DataTableCell>
                  <DataTableCell>{dateTime(item.recordedAt, row.timezone)}</DataTableCell>
                  <DataTableCell>{dateTime(item.deviceCapturedAt, row.timezone)}</DataTableCell>
                  <DataTableCell numeric>{metres(item.accuracyMeters)}</DataTableCell>
                  <DataTableCell numeric>{metres(item.distanceMeters)}</DataTableCell>
                  <DataTableCell numeric>{metres(item.radiusMeters)}</DataTableCell>
                  <DataTableCell className="tabular-nums">
                    {item.latitude !== null && item.longitude !== null
                      ? `${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}`
                      : EVIDENCE_STATE_LABELS[item.state]}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
        </DataTableRegion>
      )}

      <Panel titleId="retention-heading" title={<>Retention and legal hold</>}>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {retentionDays
            ? `Coordinates are purged ${retentionDays} days after capture. The location result stays with the attendance record.`
            : "Coordinates are purged after the agency's retention period."}{" "}
          A legal hold keeps this record&apos;s evidence until the hold is released.
        </p>
        {holds.length > 0 ? (
          <ul aria-label="Legal holds" className="flex flex-col gap-2 text-sm">
            {holds.map((hold) => (
              <li
                key={hold.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3"
              >
                <span className="flex flex-col gap-1">
                  <StatusChip tone={hold.releasedAt ? "neutral" : "warning"} className="w-fit">
                    {hold.releasedAt ? "Released" : "Active"} hold
                  </StatusChip>
                  <span>
                    Placed {dateTime(hold.placedAt, row.timezone)} by{" "}
                    {hold.placedByName ?? "an administrator"}
                  </span>
                  <span className="block text-muted-foreground">{hold.reason}</span>
                </span>
                {hold.releasedAt ? null : (
                  <ReleaseHoldForm
                    organisationId={organisationId}
                    attendanceId={record.attendanceId}
                    holdId={hold.id}
                  />
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {activeHold ? null : (
          <PlaceHoldForm organisationId={organisationId} attendanceId={record.attendanceId} />
        )}
      </Panel>
    </>
  );
}
