import "server-only";

import type {
  AttendanceClockState,
  AttendanceCorrectionReason,
  AttendanceCorrectionResolution,
  AttendanceCorrectionStatus,
  AttendanceEventType,
  AttendanceExceptionStatus,
  AttendanceExceptionType,
  GeofenceOutsidePolicy,
  GeofenceResult,
} from "@/lib/domain/attendance";
import type { AssignmentStatus, ShiftStatus } from "@/lib/domain/shifts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Constants, type Json } from "@/types/database.types";

/* Reads run as the signed-in user; RLS and the projections decide visibility. */

export type AgencyAttendanceRow = {
  assignmentId: string;
  attendanceId: string | null;
  shiftId: string;
  workerName: string | null;
  assignmentStatus: AssignmentStatus;
  facilityName: string;
  locationName: string;
  startAt: string;
  endAt: string;
  timezone: string;
  clockState: AttendanceClockState;
  needsReview: boolean;
  clockInAt: string | null;
  clockOutAt: string | null;
  clockInLocation: GeofenceResult | null;
  clockOutLocation: GeofenceResult | null;
  openExceptionTypes: AttendanceExceptionType[];
  pendingCorrections: number;
};

function exceptionTypes(values: string[]): AttendanceExceptionType[] {
  return values.flatMap((value) => {
    const known = Constants.public.Enums.attendance_exception_type.find((type) => type === value);
    return known ? [known] : [];
  });
}

export async function listAgencyAttendance(
  organisationId: string,
  range: { from?: string | undefined; to?: string | undefined; shiftId?: string | undefined },
): Promise<AgencyAttendanceRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_agency_attendance", {
    p_organisation_id: organisationId,
    ...(range.from ? { p_from: range.from } : {}),
    ...(range.to ? { p_to: range.to } : {}),
    ...(range.shiftId ? { p_shift_id: range.shiftId } : {}),
  });
  if (error) throw error;
  return data.map((row) => ({
    assignmentId: row.assignment_id,
    attendanceId: row.attendance_id,
    shiftId: row.shift_id,
    workerName: row.worker_name,
    assignmentStatus: row.assignment_status,
    facilityName: row.facility_name,
    locationName: row.location_name,
    startAt: row.start_at,
    endAt: row.end_at,
    timezone: row.timezone,
    clockState: row.clock_state,
    needsReview: row.needs_review,
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at,
    clockInLocation: row.clock_in_location,
    clockOutLocation: row.clock_out_location,
    openExceptionTypes: exceptionTypes(row.open_exception_types),
    pendingCorrections: row.pending_corrections,
  }));
}

export type PendingCorrection = {
  id: string;
  assignmentId: string;
  eventType: AttendanceEventType;
  requestedTime: string;
  reason: AttendanceCorrectionReason;
  note: string | null;
  requestedAt: string;
};

/** Pending corrections of the organisation (optionally one shift's assignments). */
export async function listPendingCorrections(
  organisationId: string,
  assignmentIds?: string[],
): Promise<PendingCorrection[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("attendance_corrections")
    .select(
      "id, assignment_id, requested_event_type, requested_time, reason, worker_note, requested_at",
    )
    .eq("agency_organisation_id", organisationId)
    .eq("status", "pending")
    .order("requested_at")
    .limit(200);
  if (assignmentIds) query = query.in("assignment_id", assignmentIds);
  const { data, error } = await query;
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    assignmentId: row.assignment_id,
    eventType: row.requested_event_type,
    requestedTime: row.requested_time,
    reason: row.reason,
    note: row.worker_note,
    requestedAt: row.requested_at,
  }));
}

export type OpenException = {
  id: string;
  assignmentId: string;
  type: AttendanceExceptionType;
  status: AttendanceExceptionStatus;
  severity: string;
  openedAt: string;
};

export async function listOpenExceptions(
  organisationId: string,
  assignmentIds?: string[],
): Promise<OpenException[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("attendance_exceptions")
    .select("id, assignment_id, exception_type, status, severity, opened_at")
    .eq("agency_organisation_id", organisationId)
    .in("status", ["open", "under_review"])
    .order("opened_at")
    .limit(200);
  if (assignmentIds) query = query.in("assignment_id", assignmentIds);
  const { data, error } = await query;
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    assignmentId: row.assignment_id,
    type: row.exception_type,
    status: row.status,
    severity: row.severity,
    openedAt: row.opened_at,
  }));
}

export type MyAttendance = {
  assignmentId: string;
  attendanceId: string | null;
  facilityName: string;
  locationName: string;
  startAt: string;
  endAt: string;
  timezone: string;
  shiftStatus: ShiftStatus;
  clockState: AttendanceClockState;
  clockInAt: string | null;
  clockOutAt: string | null;
  locationRequired: boolean;
  earliestClockInAt: string;
  canClockIn: boolean;
  canClockOut: boolean;
  exceptions: { type: string; status: string; resolution: string | null }[];
  corrections: {
    id: string;
    eventType: string;
    requestedTime: string;
    reason: string;
    status: AttendanceCorrectionStatus;
    resolution: AttendanceCorrectionResolution | null;
  }[];
};

function records(value: Json): { [key: string]: Json | undefined }[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is { [key: string]: Json | undefined } =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      )
    : [];
}
const str = (value: Json | undefined) => (typeof value === "string" ? value : null);

export async function listMyAttendance(organisationId: string): Promise<MyAttendance[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_my_attendance", {
    p_organisation_id: organisationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    assignmentId: row.assignment_id,
    attendanceId: row.attendance_id,
    facilityName: row.facility_name,
    locationName: row.location_name,
    startAt: row.start_at,
    endAt: row.end_at,
    timezone: row.timezone,
    shiftStatus: row.shift_status,
    clockState: row.clock_state,
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at,
    locationRequired: row.location_required,
    earliestClockInAt: row.earliest_clock_in_at,
    canClockIn: row.can_clock_in,
    canClockOut: row.can_clock_out,
    exceptions: records(row.exceptions).map((item) => ({
      type: str(item.type) ?? "",
      status: str(item.status) ?? "",
      resolution: str(item.resolution),
    })),
    corrections: records(row.corrections).flatMap((item) => {
      const status = Constants.public.Enums.attendance_correction_status.find(
        (s) => s === item.status,
      );
      const resolution =
        Constants.public.Enums.attendance_correction_resolution.find(
          (r) => r === item.resolution,
        ) ?? null;
      return status
        ? [
            {
              id: str(item.id) ?? "",
              eventType: str(item.event_type) ?? "",
              requestedTime: str(item.requested_time) ?? "",
              reason: str(item.reason) ?? "",
              status,
              resolution,
            },
          ]
        : [];
    }),
  }));
}

export type FacilityAttendanceRow = {
  assignmentId: string;
  workerName: string | null;
  clockState: AttendanceClockState;
  clockInAt: string | null;
  clockOutAt: string | null;
  clockInLocation: GeofenceResult | null;
  clockOutLocation: GeofenceResult | null;
  hasOpenException: boolean;
};

export async function listFacilityShiftAttendance(
  shiftId: string,
): Promise<FacilityAttendanceRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_facility_shift_attendance", {
    p_shift_id: shiftId,
  });
  if (error) throw error;
  return data.map((row) => ({
    assignmentId: row.assignment_id,
    workerName: row.worker_display_name,
    clockState: row.clock_state,
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at,
    clockInLocation: row.clock_in_location,
    clockOutLocation: row.clock_out_location,
    hasOpenException: row.has_open_exception,
  }));
}

export type AttendanceRules = {
  earlyClockInMinutes: number;
  lateClockInMinutes: number;
  earlyClockOutMinutes: number;
  lateClockOutMinutes: number;
  missedClockInMinutes: number;
  missedClockOutMinutes: number;
  clockOutCutoffMinutes: number;
  isDefault: boolean;
};

export async function getAttendanceRules(organisationId: string): Promise<AttendanceRules> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agency_attendance_settings")
    .select("*")
    .eq("agency_organisation_id", organisationId)
    .maybeSingle();
  if (error) throw error;
  return {
    earlyClockInMinutes: data?.early_clock_in_minutes ?? 30,
    lateClockInMinutes: data?.late_clock_in_minutes ?? 5,
    earlyClockOutMinutes: data?.early_clock_out_minutes ?? 15,
    lateClockOutMinutes: data?.late_clock_out_minutes ?? 30,
    missedClockInMinutes: data?.missed_clock_in_minutes ?? 15,
    missedClockOutMinutes: data?.missed_clock_out_minutes ?? 60,
    clockOutCutoffMinutes: data?.clock_out_cutoff_minutes ?? 240,
    isDefault: data === null,
  };
}

export type LocationGeofence = {
  locationId: string;
  enabled: boolean;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  maxAccuracyMeters: number;
  outsidePolicy: GeofenceOutsidePolicy;
};

export async function listLocationGeofences(facilityId: string): Promise<LocationGeofence[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("location_geofences")
    .select(
      "facility_location_id, enabled, latitude, longitude, radius_meters, max_accuracy_meters, outside_policy",
    )
    .eq("agency_facility_id", facilityId);
  if (error) throw error;
  return data.map((row) => ({
    locationId: row.facility_location_id,
    enabled: row.enabled,
    latitude: row.latitude,
    longitude: row.longitude,
    radiusMeters: row.radius_meters,
    maxAccuracyMeters: row.max_accuracy_meters,
    outsidePolicy: row.outside_policy,
  }));
}
