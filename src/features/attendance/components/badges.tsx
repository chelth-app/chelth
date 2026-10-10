import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import {
  ATTENDANCE_STATE_LABELS,
  type AttendanceClockState,
  type AttendanceState,
  checkInBlockedByConfiguration,
  deriveAttendanceState,
  GEOFENCE_READINESS_LABELS,
  type GeofenceReadiness,
} from "@/lib/domain/attendance";

const TONE: Record<AttendanceState, StatusTone> = {
  not_started: "neutral",
  clocked_in: "info",
  on_break: "info",
  clocked_out: "success",
  needs_review: "warning",
};

export function AttendanceStateBadge({
  clockState,
  needsReview,
}: {
  clockState: AttendanceClockState;
  needsReview: boolean;
}) {
  const state = deriveAttendanceState(clockState, needsReview);
  return <StatusChip tone={TONE[state]}>{ATTENDANCE_STATE_LABELS[state]}</StatusChip>;
}

/**
 * A location's geofence status for operators. When the agency requires
 * geofencing, an unconfigured location blocks worker check-in (danger);
 * otherwise it is only a setup gap (neutral / warning).
 */
export function GeofenceReadinessBadge({
  readiness,
  requireGeofence,
}: {
  readiness: GeofenceReadiness;
  requireGeofence: boolean;
}) {
  const tone: StatusTone =
    readiness === "ready"
      ? "success"
      : readiness === "not_blocking"
        ? "info"
        : readiness === "invalid" || checkInBlockedByConfiguration(requireGeofence, readiness)
          ? "danger"
          : readiness === "not_configured"
            ? "warning"
            : "neutral";
  return <StatusChip tone={tone}>{GEOFENCE_READINESS_LABELS[readiness]}</StatusChip>;
}
