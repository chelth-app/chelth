import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

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
      <header className="flex flex-col gap-2">
        <Link href={recordPath} className="w-fit text-sm text-primary underline underline-offset-4">
          Attendance record
        </Link>
        <h1 className="text-2xl font-semibold">Location evidence</h1>
        <p className="text-sm text-muted-foreground">
          {row.workerName ?? "Worker"} · {row.facilityName} · {formatShiftDate(row)}
        </p>
      </header>

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
        <p className="text-sm text-muted-foreground">
          No location evidence: this site did not check location for this record.
        </p>
      ) : (
        <div
          role="region"
          aria-label="Location evidence table"
          tabIndex={0}
          className="overflow-x-auto rounded-lg border border-border bg-surface"
        >
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Clock action
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Result
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Recorded (server)
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Captured (device)
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Accuracy
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Distance
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Radius
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Coordinates
                </th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((item) => (
                <tr
                  key={`${item.eventType}-${item.recordedAt}`}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-3 py-2 font-medium">
                    {ATTENDANCE_EVENT_LABELS[item.eventType]}
                  </td>
                  <td className="px-3 py-2">{GEOFENCE_RESULT_LABELS[item.result]}</td>
                  <td className="px-3 py-2">{dateTime(item.recordedAt, row.timezone)}</td>
                  <td className="px-3 py-2">{dateTime(item.deviceCapturedAt, row.timezone)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {metres(item.accuracyMeters)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {metres(item.distanceMeters)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{metres(item.radiusMeters)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {item.latitude !== null && item.longitude !== null
                      ? `${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}`
                      : EVIDENCE_STATE_LABELS[item.state]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section aria-labelledby="retention-heading" className="flex flex-col gap-3">
        <h2 id="retention-heading" className="text-lg font-semibold">
          Retention and legal hold
        </h2>
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
                <span>
                  {hold.releasedAt ? "Released" : "Active"} hold · placed{" "}
                  {dateTime(hold.placedAt, row.timezone)} by{" "}
                  {hold.placedByName ?? "an administrator"}
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
      </section>
    </>
  );
}
