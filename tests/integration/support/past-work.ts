import postgres from "postgres";

import { zonedLocalToInstant } from "@/lib/domain/attendance";

import { SUPABASE_DB_URL } from "./env";
import type { TestIdentity } from "./identities";
import { must } from "./staffing";

/**
 * Arranges work that happened in the PAST. The public API refuses to schedule
 * or clock the past, so — like the pgTAP fixtures — the owner role places a
 * draft shift in the past, opens it, records an accepted assignment, appends
 * device events whose recorded time equals their occurred time (the only
 * shape the table accepts) and runs the one trusted projection refresh.
 * Never used to test authorization. Local stack only.
 */

export type PastEvent = {
  type: "clock_in" | "clock_out" | "break_start" | "break_end";
  at: string;
  segment?: number;
};

export function localInstant(date: string, time: string, timezone: string): string {
  const instant = zonedLocalToInstant(date, time, timezone);
  if (!instant) throw new Error(`no such local time ${date} ${time} ${timezone}`);
  return instant;
}

/** Monday of the week two weeks back: a closed period under the default week start. */
export function closedPeriodStart(): string {
  const date = new Date(Date.now() - 14 * 86_400_000);
  const isoDow = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (isoDow - 1));
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function pastWork(options: {
  scheduler: TestIdentity;
  organisationId: string;
  facilityId: string;
  locationId: string;
  workerId: string;
  workerProfileId: string;
  startAt: string;
  endAt: string;
  events: PastEvent[];
}): Promise<{ shiftId: string; assignmentId: string; attendanceId: string | null }> {
  const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const shiftId = await must(
    options.scheduler.client.rpc("create_shift", {
      p_agency_facility_id: options.facilityId,
      p_facility_location_id: options.locationId,
      p_discipline_key: "cna",
      p_shift_date: future,
      p_start_time: "07:00",
      p_end_time: "15:00",
      p_requested_headcount: 2,
      p_open: false,
    }),
  );
  const sql = postgres(SUPABASE_DB_URL, { max: 1 });
  try {
    await sql`update public.shifts set start_at = ${options.startAt}, end_at = ${options.endAt} where id = ${shiftId}`;
    await sql`update public.shifts set status = 'open', opened_at = now() where id = ${shiftId}`;
    const [membership] = await sql<{ id: string }[]>`
      select id from public.organisation_memberships
      where organisation_id = ${options.organisationId} and profile_id = ${options.scheduler.userId}`;
    const [assignment] = await sql<{ id: string }[]>`
      insert into public.shift_assignments
        (shift_id, agency_organisation_id, agency_worker_id, profile_id, start_at, end_at, assigned_by_membership_id)
      values (${shiftId}, ${options.organisationId}, ${options.workerId}, ${options.workerProfileId},
              ${options.startAt}, ${options.endAt}, ${membership?.id ?? null})
      returning id`;
    const assignmentId = assignment?.id ?? "";
    await sql`update public.shift_assignments set status = 'accepted', accepted_at = now() where id = ${assignmentId}`;
    let attendanceId: string | null = null;
    for (const event of options.events) {
      const [attendance] = await sql<{ id: string }[]>`
        select (internal.ensure_attendance(${assignmentId}::uuid)).id as id`;
      attendanceId = attendance?.id ?? null;
      await sql`
        insert into public.attendance_events
          (attendance_id, assignment_id, agency_organisation_id, event_type, segment, occurred_at, recorded_at, source)
        values (${attendanceId}, ${assignmentId}, ${options.organisationId}, ${event.type}::public.attendance_event_type,
                ${event.segment ?? 1}, ${event.at}, ${event.at}, 'worker_device')`;
      await sql`select internal.refresh_attendance(${attendanceId}::uuid)`;
    }
    return { shiftId, assignmentId, attendanceId };
  } finally {
    await sql.end();
  }
}

/** Owner: location evidence captured at a past clock-in (for retention tests). */
export async function pastEvidence(assignmentId: string, at: string): Promise<string> {
  const sql = postgres(SUPABASE_DB_URL, { max: 1 });
  try {
    const [attendance] = await sql<{ id: string; organisation: string }[]>`
      select (a).id as id, (a).agency_organisation_id as organisation
      from (select internal.ensure_attendance(${assignmentId}::uuid) as a) q`;
    const attendanceId = attendance?.id ?? "";
    const [event] = await sql<{ id: string }[]>`
      insert into public.attendance_events
        (attendance_id, assignment_id, agency_organisation_id, event_type, occurred_at, recorded_at, source, geofence_result)
      values (${attendanceId}, ${assignmentId}, ${attendance?.organisation ?? ""}, 'clock_in', ${at}, ${at},
              'worker_device', 'inside')
      returning id`;
    await sql`
      insert into public.attendance_location_evidence
        (event_id, attendance_id, agency_organisation_id, latitude, longitude, accuracy_meters,
         device_captured_at, distance_meters, radius_meters, result, recorded_at)
      values (${event?.id ?? ""}, ${attendanceId}, ${attendance?.organisation ?? ""}, 40.7128, -74.006, 12,
              ${at}, 10, 200, 'inside', ${at})`;
    await sql`select internal.refresh_attendance(${attendanceId}::uuid)`;
    return attendanceId;
  } finally {
    await sql.end();
  }
}

export async function runEvidencePurge(): Promise<void> {
  const sql = postgres(SUPABASE_DB_URL, { max: 1 });
  try {
    await sql`select internal.run_location_evidence_purge()`;
  } finally {
    await sql.end();
  }
}
