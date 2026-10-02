import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import {
  ASSIGNMENT_STATUS_LABELS,
  type AssignmentStatus,
  FILL_STATE_LABELS,
  type FillState,
  SHIFT_OFFER_STATUS_LABELS,
  SHIFT_STATUS_LABELS,
  type ShiftOfferStatus,
  type ShiftStatus,
} from "@/lib/domain/shifts";

type Tone = StatusTone;

const SHIFT_TONE: Record<ShiftStatus, Tone> = {
  draft: "neutral",
  submitted: "info",
  open: "info",
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
  return <StatusChip tone={SHIFT_TONE[status]}>{SHIFT_STATUS_LABELS[status]}</StatusChip>;
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
    <StatusChip tone={FILL_TONE[fillState]}>
      {FILL_STATE_LABELS[fillState]} · {activeCount} of {requestedHeadcount}
    </StatusChip>
  );
}

export function AssignmentStatusBadge({ status }: { status: AssignmentStatus }) {
  return <StatusChip tone={ASSIGNMENT_TONE[status]}>{ASSIGNMENT_STATUS_LABELS[status]}</StatusChip>;
}

const OFFER_TONE: Record<ShiftOfferStatus, Tone> = {
  offered: "info",
  accepted: "success",
  declined: "warning",
  expired: "neutral",
  cancelled: "neutral",
};

export function OfferStatusBadge({ status }: { status: ShiftOfferStatus }) {
  return <StatusChip tone={OFFER_TONE[status]}>{SHIFT_OFFER_STATUS_LABELS[status]}</StatusChip>;
}
