import { Badge, type BadgeProps } from "@/components/ui/badge";
import {
  ASSIGNMENT_STATUS_LABELS,
  type AssignmentStatus,
  FILL_STATE_LABELS,
  type FillState,
  SHIFT_STATUS_LABELS,
  type ShiftStatus,
} from "@/lib/domain/shifts";

type Tone = NonNullable<BadgeProps["tone"]>;

const SHIFT_TONE: Record<ShiftStatus, Tone> = {
  draft: "neutral",
  submitted: "info",
  open: "brand",
  cancelled: "danger",
  completed: "success",
};

const FILL_TONE: Record<FillState, Tone> = {
  unfilled: "warning",
  partially_filled: "info",
  filled: "success",
};

const ASSIGNMENT_TONE: Record<AssignmentStatus, Tone> = {
  assigned: "info",
  accepted: "success",
  declined: "warning",
  cancelled: "neutral",
};

export function ShiftStatusBadge({ status }: { status: ShiftStatus }) {
  return <Badge tone={SHIFT_TONE[status]}>{SHIFT_STATUS_LABELS[status]}</Badge>;
}

/** Derived fill progress, e.g. "Partially filled · 1 of 2". */
export function FillBadge({
  fillState,
  activeCount,
  requestedHeadcount,
}: {
  fillState: FillState;
  activeCount: number;
  requestedHeadcount: number;
}) {
  return (
    <Badge tone={FILL_TONE[fillState]}>
      {FILL_STATE_LABELS[fillState]} · {activeCount} of {requestedHeadcount}
    </Badge>
  );
}

export function AssignmentStatusBadge({ status }: { status: AssignmentStatus }) {
  return <Badge tone={ASSIGNMENT_TONE[status]}>{ASSIGNMENT_STATUS_LABELS[status]}</Badge>;
}
