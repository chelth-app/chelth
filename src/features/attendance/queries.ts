import "server-only";

import type {
  AttendanceAdjustmentReason,
  AttendanceClockState,
  AttendanceCorrectionOrigin,
  AttendanceCorrectionReason,
  AttendanceCorrectionResolution,
  AttendanceCorrectionStatus,
  AttendanceEventType,
  AttendanceExceptionStatus,
  AttendanceExceptionType,
  GeofenceOutsidePolicy,
  GeofencePolicy,
  GeofenceReadiness,
  GeofenceResult,
  LocationEvidenceState,
} from "@/lib/domain/attendance";
import { GEOFENCE_POLICY_DEFAULTS } from "@/lib/domain/attendance";
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
  attendanceId: string;
  segment: number;
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
      "id, assignment_id, attendance_id, segment, requested_event_type, requested_time, reason, worker_note, requested_at",
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
    attendanceId: row.attendance_id,
    segment: row.segment,
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
  canStartBreak: boolean;
  canEndBreak: boolean;
  breakMinutes: number | null;
  workedMinutes: number | null;
  exceptions: { type: string; status: string; resolution: string | null }[];
  corrections: {
    id: string;
    eventType: string;
    segment: number;
    requestedTime: string;
    approvedTime: string | null;
    reason: string;
    status: AttendanceCorrectionStatus;
    resolution: AttendanceCorrectionResolution | null;
    origin: AttendanceCorrectionOrigin;
    adjustmentReason: AttendanceAdjustmentReason | null;
    reviewerNote: string | null;
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
    canStartBreak: row.can_start_break,
    canEndBreak: row.can_end_break,
    breakMinutes: row.break_minutes,
    workedMinutes: row.worked_minutes,
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
      const origin =
        Constants.public.Enums.attendance_correction_origin.find((o) => o === item.origin) ??
        "worker_request";
      const adjustmentReason =
        Constants.public.Enums.attendance_adjustment_reason.find(
          (r) => r === item.adjustment_reason,
        ) ?? null;
      return status
        ? [
            {
              id: str(item.id) ?? "",
              eventType: str(item.event_type) ?? "",
              segment: typeof item.segment === "number" ? item.segment : 1,
              requestedTime: str(item.requested_time) ?? "",
              approvedTime: str(item.approved_time),
              reason: str(item.reason) ?? "",
              status,
              resolution,
              origin,
              adjustmentReason,
              reviewerNote: str(item.reviewer_note),
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
  retentionDays: number;
  geofencePolicy: GeofencePolicy;
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
    retentionDays: data?.location_evidence_retention_days ?? 90,
    geofencePolicy: data
      ? {
          requireGeofence: data.require_geofence,
          defaultRadiusMeters: data.default_geofence_radius_meters,
          defaultMaxAccuracyMeters: data.default_geofence_max_accuracy_meters,
          defaultOutsidePolicy: data.default_geofence_outside_policy,
        }
      : GEOFENCE_POLICY_DEFAULTS,
    isDefault: data === null,
  };
}

export type GeofenceReadinessRow = {
  facilityId: string;
  facilityName: string;
  locationId: string;
  locationName: string;
  /** The location and its facility are both active. */
  locationActive: boolean;
  enabled: boolean;
  radiusMeters: number | null;
  maxAccuracyMeters: number | null;
  outsidePolicy: GeofenceOutsidePolicy | null;
  readiness: GeofenceReadiness;
};

/** Per-location worker check-in readiness (facility.view). Never includes coordinates. */
export async function listGeofenceReadiness(
  organisationId: string,
): Promise<GeofenceReadinessRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_geofence_readiness", {
    p_organisation_id: organisationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    facilityId: row.facility_id,
    facilityName: row.facility_name,
    locationId: row.location_id,
    locationName: row.location_name,
    locationActive: row.location_active,
    enabled: row.enabled,
    radiusMeters: row.radius_meters,
    maxAccuracyMeters: row.max_accuracy_meters,
    outsidePolicy: row.outside_policy,
    readiness: row.readiness,
  }));
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

export type AttendanceRecord = {
  attendanceId: string;
  assignmentId: string;
  shiftId: string;
  clockState: AttendanceClockState;
  openExceptionCount: number;
};

/** One attendance record of the organisation (RLS: attendance.view). */
export async function getAttendanceRecord(
  organisationId: string,
  attendanceId: string,
): Promise<AttendanceRecord | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("assignment_attendance")
    .select("id, assignment_id, shift_id, clock_state, open_exception_count")
    .eq("agency_organisation_id", organisationId)
    .eq("id", attendanceId)
    .maybeSingle();
  if (error) throw error;
  return data
    ? {
        attendanceId: data.id,
        assignmentId: data.assignment_id,
        shiftId: data.shift_id,
        clockState: data.clock_state,
        openExceptionCount: data.open_exception_count,
      }
    : null;
}

export type AttendanceHistoryItem = {
  kind: "event" | "correction" | "exception";
  id: string;
  at: string;
  eventType: string;
  segment: number | null;
  detail: { [key: string]: Json | undefined };
};

/**
 * The full, append-only story of one attendance record: original events,
 * requests, decisions, corrected events and exceptions. Never coordinates.
 */
export async function listAttendanceHistory(
  attendanceId: string,
): Promise<AttendanceHistoryItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_attendance_history", {
    p_attendance_id: attendanceId,
  });
  if (error) throw error;
  return data.flatMap((row) => {
    const kind =
      row.item_kind === "event" || row.item_kind === "correction" || row.item_kind === "exception"
        ? row.item_kind
        : null;
    const detail =
      typeof row.detail === "object" && row.detail !== null && !Array.isArray(row.detail)
        ? row.detail
        : {};
    return kind
      ? [
          {
            kind,
            id: row.item_id,
            at: row.at,
            eventType: row.event_type,
            segment: row.segment,
            detail,
          },
        ]
      : [];
  });
}

export type AttendanceExceptionRow = OpenException & {
  resolution: string | null;
  resolvedAt: string | null;
};

export async function listAttendanceExceptions(
  attendanceId: string,
): Promise<AttendanceExceptionRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_exceptions")
    .select(
      "id, assignment_id, exception_type, status, severity, opened_at, resolution, resolved_at",
    )
    .eq("attendance_id", attendanceId)
    .order("opened_at");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    assignmentId: row.assignment_id,
    type: row.exception_type,
    status: row.status,
    severity: row.severity,
    openedAt: row.opened_at,
    resolution: row.resolution,
    resolvedAt: row.resolved_at,
  }));
}

export type LocationEvidenceRow = {
  eventType: AttendanceEventType;
  result: GeofenceResult;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  distanceMeters: number | null;
  radiusMeters: number;
  deviceCapturedAt: string | null;
  recordedAt: string;
  purgedAt: string | null;
  state: LocationEvidenceState;
  retentionDays: number;
};

/** Raw evidence: attendance.location.view at AAL2; the database audits every read. */
export async function listLocationEvidence(attendanceId: string): Promise<LocationEvidenceRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_attendance_location_evidence", {
    p_attendance_id: attendanceId,
  });
  if (error) throw error;
  return data.map((row) => ({
    eventType: row.event_type,
    result: row.result,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.accuracy_meters,
    distanceMeters: row.distance_meters,
    radiusMeters: row.radius_meters,
    deviceCapturedAt: row.device_captured_at,
    recordedAt: row.recorded_at,
    purgedAt: row.purged_at,
    state: row.state,
    retentionDays: row.retention_days,
  }));
}

export type EvidenceHold = {
  id: string;
  reason: string;
  placedAt: string;
  placedByName: string | null;
  releasedAt: string | null;
};

export async function listEvidenceHolds(attendanceId: string): Promise<EvidenceHold[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_location_evidence_holds", {
    p_attendance_id: attendanceId,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.hold_id,
    reason: row.reason,
    placedAt: row.placed_at,
    placedByName: row.placed_by_name,
    releasedAt: row.released_at,
  }));
}
