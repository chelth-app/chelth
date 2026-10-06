import type { StatusTone } from "@/components/ui/status-chip";
import type { AttendanceState, GeofenceResult } from "@/lib/domain/attendance";

/** Same tones as AttendanceStateBadge (features/attendance). */
export const ATTENDANCE_TONE: Record<AttendanceState, StatusTone> = {
  not_started: "neutral",
  clocked_in: "info",
  on_break: "info",
  clocked_out: "success",
  needs_review: "warning",
};

/** Derived location-check results (never coordinates). */
export const GEOFENCE_TONE: Record<GeofenceResult, StatusTone> = {
  not_required: "neutral",
  inside: "success",
  outside: "danger",
  low_accuracy: "warning",
  unavailable: "warning",
};
