import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import {
  ATTENDANCE_STATE_LABELS,
  type AttendanceClockState,
  type AttendanceState,
  deriveAttendanceState,
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
