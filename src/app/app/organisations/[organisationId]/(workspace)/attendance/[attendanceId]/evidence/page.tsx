import type { Metadata } from "next";
import Link from "next/link";

import { notFound } from "next/navigation";
import { z } from "zod";

import { RefChip } from "@/components/reference/locked-reference";
import {
  RECORD_ROW,
  RECORD_ROW_META,
  RECORD_ROW_TITLE,
  RecordList,
  RecordNote,
  RecordPage,
} from "@/components/reference/record-page";

import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
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

import { LockedEmpty, LockedNotice } from "../../../(finance)/_components/finance-locked";

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
 * Locked record family (P0-E8-QA-F3): presentation only.
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
      <RecordPage>
        <PageHeader
          variant="reference"
          title="Location evidence"
          back={
            <Link href={recordPath} className="text-primary underline underline-offset-4">
              Attendance record
            </Link>
          }
        />
        <StepUpNotice returnTo={returnTo}>
          Raw location evidence requires verification with your authenticator app.
        </StepUpNotice>
      </RecordPage>
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
    <RecordPage>
      <PageHeader
        variant="reference"
        title="Location evidence"
        back={
          <Link href={recordPath} className="text-primary underline underline-offset-4">
            Attendance record
          </Link>
        }
        description={
          <p>
            {row.workerName ?? "Worker"} · {row.facilityName} · {formatShiftDate(row)}
          </p>
        }
        meta={
          activeHold ? (
            <RefChip tone="warning" className="font-semibold">
              Legal hold active
            </RefChip>
          ) : undefined
        }
      />

      <div role="note" className="max-w-3xl">
        <LockedNotice
          tone="info"
          title="Device-reported location, captured once at each clock action where this site checks location."
        >
          It is evidence for review, not proof of presence: devices can report inaccurate or altered
          locations. Chelth never tracks workers continuously. This view is recorded in the audit
          log.
        </LockedNotice>
      </div>

      <Panel titleId="evidence-heading" title={<>Clock-action evidence</>}>
        {evidence.length === 0 ? (
          <LockedEmpty
            icon="attendance"
            title="No location evidence"
            note="This site did not check location for this record."
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
      </Panel>

      <Panel titleId="retention-heading" title={<>Retention and legal hold</>}>
        <RecordNote className="max-w-2xl">
          {retentionDays
            ? `Coordinates are purged ${retentionDays} days after capture. The location result stays with the attendance record.`
            : "Coordinates are purged after the agency's retention period."}{" "}
          A legal hold keeps this record&apos;s evidence until the hold is released.
        </RecordNote>
        {holds.length > 0 ? (
          <RecordList label="Legal holds">
            {holds.map((hold) => (
              <li key={hold.id} className={`${RECORD_ROW} justify-between`}>
                <span className="flex min-w-0 flex-col gap-1">
                  <RefChip
                    tone={hold.releasedAt ? "neutral" : "warning"}
                    className="w-fit font-semibold"
                  >
                    {hold.releasedAt ? "Released" : "Active"} hold
                  </RefChip>
                  <span className={RECORD_ROW_TITLE}>
                    Placed {dateTime(hold.placedAt, row.timezone)} by{" "}
                    {hold.placedByName ?? "an administrator"}
                  </span>
                  <span className={`${RECORD_ROW_META} break-words`}>{hold.reason}</span>
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
          </RecordList>
        ) : null}
        {activeHold ? null : (
          <PlaceHoldForm organisationId={organisationId} attendanceId={record.attendanceId} />
        )}
      </Panel>
    </RecordPage>
  );
}
