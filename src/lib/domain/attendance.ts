/**
 * Attendance vocabulary (P0-E6-S1).
 *
 * Enum-backed types and value lists come from the generated database types.
 * The database is the authority for every attendance decision; these labels
 * and derivations are presentation only.
 */
import { Constants, type Database } from "@/types/database.types";

type Enums = Database["public"]["Enums"];

export type AttendanceClockState = Enums["attendance_clock_state"];
export type AttendanceEventType = Enums["attendance_event_type"];
export type AttendanceEventSource = Enums["attendance_event_source"];
export type GeofenceResult = Enums["geofence_result"];
export type GeofenceOutsidePolicy = Enums["geofence_outside_policy"];
export type AttendanceExceptionType = Enums["attendance_exception_type"];
export type AttendanceExceptionStatus = Enums["attendance_exception_status"];
export type AttendanceExceptionResolution = Enums["attendance_exception_resolution"];
export type AttendanceCorrectionReason = Enums["attendance_correction_reason"];
export type AttendanceCorrectionStatus = Enums["attendance_correction_status"];
export type AttendanceCorrectionResolution = Enums["attendance_correction_resolution"];

export const GEOFENCE_OUTSIDE_POLICIES = Constants.public.Enums.geofence_outside_policy;
export const ATTENDANCE_CORRECTION_REASONS = Constants.public.Enums.attendance_correction_reason;
export const ATTENDANCE_CORRECTION_RESOLUTIONS =
  Constants.public.Enums.attendance_correction_resolution;
export const REJECTION_RESOLUTIONS = ATTENDANCE_CORRECTION_RESOLUTIONS.filter(
  (resolution): resolution is Exclude<AttendanceCorrectionResolution, "approved_as_requested"> =>
    resolution !== "approved_as_requested",
);

/** Displayed state: open exceptions put a record in "needs review". */
export type AttendanceState = AttendanceClockState | "needs_review";

export function deriveAttendanceState(
  clockState: AttendanceClockState,
  needsReview: boolean,
): AttendanceState {
  return needsReview ? "needs_review" : clockState;
}

export const ATTENDANCE_STATE_LABELS: Record<AttendanceState, string> = {
  not_started: "Not started",
  clocked_in: "Clocked in",
  clocked_out: "Completed",
  needs_review: "Needs review",
};

export const CLOCK_STATE_LABELS: Record<AttendanceClockState, string> = {
  not_started: "Not started",
  clocked_in: "Clocked in",
  clocked_out: "Completed",
};

/** What a facility or agency sees: a result, never coordinates. */
export const GEOFENCE_RESULT_LABELS: Record<GeofenceResult, string> = {
  not_required: "Not required",
  inside: "Inside site area",
  outside: "Outside site area",
  low_accuracy: "Location too imprecise",
  unavailable: "Location unavailable",
};

export const GEOFENCE_POLICY_LABELS: Record<GeofenceOutsidePolicy, string> = {
  block: "Block clock-in outside the area",
  allow_with_review: "Allow and flag for review",
};

export const ATTENDANCE_EXCEPTION_LABELS: Record<AttendanceExceptionType, string> = {
  late_clock_in: "Late clock-in",
  early_clock_out: "Early clock-out",
  late_clock_out: "Late clock-out",
  missed_clock_in: "Missed clock-in",
  missed_clock_out: "Missed clock-out",
  outside_geofence: "Outside site area",
  poor_location_accuracy: "Imprecise location",
  location_unavailable: "Location unavailable",
  assignment_not_ready: "Not eligible at clock-in",
  manual_correction_requested: "Correction requested",
};

export const ATTENDANCE_EXCEPTION_STATUS_LABELS: Record<AttendanceExceptionStatus, string> = {
  open: "Open",
  under_review: "Under review",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export const CORRECTION_REASON_LABELS: Record<AttendanceCorrectionReason, string> = {
  forgot_to_clock: "I forgot to clock",
  device_or_app_problem: "Device or app problem",
  location_problem: "Location problem",
  recorded_wrong_time: "The recorded time is wrong",
  other: "Other",
};

export const CORRECTION_STATUS_LABELS: Record<AttendanceCorrectionStatus, string> = {
  pending: "Awaiting review",
  approved: "Approved",
  rejected: "Not approved",
};

export const CORRECTION_RESOLUTION_LABELS: Record<AttendanceCorrectionResolution, string> = {
  approved_as_requested: "Approved as requested",
  rejected_time_not_supported: "Time not supported",
  rejected_duplicate: "Duplicate request",
  rejected_other: "Other reason",
};

/** Documented defaults (docs/architecture/ATTENDANCE_DOMAIN_MODEL.md §4). */
export const ATTENDANCE_DEFAULTS = {
  earlyClockInMinutes: 30,
  lateClockInMinutes: 5,
  earlyClockOutMinutes: 15,
  lateClockOutMinutes: 30,
  missedClockInMinutes: 15,
  missedClockOutMinutes: 60,
  clockOutCutoffMinutes: 240,
} as const;

export const GEOFENCE_RADIUS_BOUNDS = { min: 50, max: 2000 } as const;
export const GEOFENCE_ACCURACY_BOUNDS = { min: 10, max: 500 } as const;

/**
 * Converts a wall-clock date/time in an IANA timezone to a UTC instant (ISO).
 * Used for correction requests entered in the shift's local time. Returns
 * null for times that do not exist in that zone (DST spring-forward gap);
 * ambiguous fall-back times resolve to the later (standard-time) instant,
 * matching the database's shift conversion.
 */
export function zonedLocalToInstant(date: string, time: string, timezone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !clock) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const [hour, minute] = [Number(clock[1]), Number(clock[2])];
  if (hour > 23 || minute > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // Reject impossible dates (Date.UTC would silently roll 2030-13-99 forward).
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(instant));
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return (
      Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute")) -
      instant
    );
  };
  // Candidates from both offsets around the wall time; prefer the later one.
  const candidates = [wall - offsetAt(wall - 86_400_000), wall - offsetAt(wall + 86_400_000)]
    .filter((instant) => instant + offsetAt(instant) === wall)
    .sort((a, b) => b - a);
  const chosen = candidates[0];
  return chosen === undefined ? null : new Date(chosen).toISOString();
}

/** "7:03 AM EDT" in the shift's own timezone (never the viewer's). */
export function formatLocalClockTime(instant: string | null, timezone: string): string {
  if (!instant) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(instant));
}
