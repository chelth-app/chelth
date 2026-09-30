import { Badge, type BadgeProps } from "@/components/ui/badge";
import {
  ATTENDANCE_STATE_LABELS,
  type AttendanceClockState,
  type AttendanceState,
  deriveAttendanceState,
} from "@/lib/domain/attendance";

const TONE: Record<AttendanceState, NonNullable<BadgeProps["tone"]>> = {
  not_started: "neutral",
  clocked_in: "info",
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
  return <Badge tone={TONE[state]}>{ATTENDANCE_STATE_LABELS[state]}</Badge>;
}
