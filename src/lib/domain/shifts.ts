/**
 * Shift & assignment vocabulary (P0-E5-S1).
 *
 * Enum-backed types and value lists come from the generated database types.
 * Transitions mirror the database triggers/RPCs and drive UI affordances
 * only; the database is the authority. Fill state is DERIVED here exactly as
 * in the database projections (never stored).
 */
import { Constants, type Database } from "@/types/database.types";

import type { ErrorCode } from "@/lib/errors";

type Enums = Database["public"]["Enums"];

export type ShiftStatus = Enums["shift_status"];
export type ShiftSource = Enums["shift_source"];
export type ShiftCancellationReason = Enums["shift_cancellation_reason"];
export type AssignmentStatus = Enums["assignment_status"];
export type AssignmentCancellationReason = Enums["assignment_cancellation_reason"];
export type AssignmentBlockReason = Enums["assignment_block_reason"];
export type AssignmentDecisionOutcome = Enums["assignment_decision_outcome"];

export const SHIFT_STATUSES = Constants.public.Enums.shift_status;
export const SHIFT_SOURCES = Constants.public.Enums.shift_source;
export const SHIFT_CANCELLATION_REASONS = Constants.public.Enums.shift_cancellation_reason;
export const ASSIGNMENT_STATUSES = Constants.public.Enums.assignment_status;
export const ASSIGNMENT_BLOCK_REASONS = Constants.public.Enums.assignment_block_reason;
/** shift_cancelled is set only by cancelling the shift itself. */
export const ASSIGNMENT_CANCELLATION_REASONS =
  Constants.public.Enums.assignment_cancellation_reason.filter(
    (reason): reason is Exclude<AssignmentCancellationReason, "shift_cancelled"> =>
      reason !== "shift_cancelled",
  );

/** Assignment states that consume headcount and block the person's time. */
export const ACTIVE_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = ["assigned", "accepted"];

export function isActiveAssignment(status: AssignmentStatus): boolean {
  return ACTIVE_ASSIGNMENT_STATUSES.includes(status);
}

export const SHIFT_STATUS_LABELS: Record<ShiftStatus, string> = {
  draft: "Draft",
  submitted: "Requested",
  open: "Open",
  cancelled: "Cancelled",
  completed: "Completed",
};

export const SHIFT_SOURCE_LABELS: Record<ShiftSource, string> = {
  agency: "Agency",
  facility: "Facility request",
};

export const SHIFT_STATUS_TRANSITIONS: Record<ShiftStatus, readonly ShiftStatus[]> = {
  draft: ["open", "cancelled"],
  submitted: ["open", "cancelled"],
  open: ["cancelled", "completed"],
  cancelled: [],
  completed: [],
};

export const SHIFT_CANCELLATION_REASON_LABELS: Record<ShiftCancellationReason, string> = {
  facility_cancelled: "Cancelled by the facility",
  staffing_no_longer_needed: "Staffing no longer needed",
  entered_in_error: "Entered in error",
  relationship_suspended: "Relationship suspended",
  other: "Other",
};

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  assigned: "Awaiting response",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
};

export const ASSIGNMENT_CANCELLATION_REASON_LABELS: Record<AssignmentCancellationReason, string> = {
  shift_cancelled: "Shift cancelled",
  worker_unavailable: "Worker unavailable",
  compliance_change: "Compliance changed",
  entered_in_error: "Entered in error",
  relationship_suspended: "Relationship suspended",
  other: "Other",
};

/** Plain-language block reasons. Deliberately generic for schedule conflicts. */
export const ASSIGNMENT_BLOCK_REASON_LABELS: Record<AssignmentBlockReason, string> = {
  ASSIGNMENT_ALREADY_EXISTS: "Already assigned to this shift",
  SHIFT_FULL: "Shift is full",
  WORKER_NOT_ACTIVE: "Worker is not active",
  DISCIPLINE_MISMATCH: "Wrong discipline for this shift",
  WORKER_NOT_ELIGIBLE: "Not compliant for this facility on the shift date",
  WORKER_SCHEDULE_CONFLICT: "Worker has a scheduling conflict",
};

/** Block reason → structured application error code. */
export const ASSIGNMENT_BLOCK_ERROR: Record<AssignmentBlockReason, ErrorCode> = {
  ASSIGNMENT_ALREADY_EXISTS: "ASSIGNMENT_ALREADY_EXISTS",
  SHIFT_FULL: "SHIFT_FULL",
  WORKER_NOT_ACTIVE: "WORKER_NOT_ACTIVE",
  DISCIPLINE_MISMATCH: "DISCIPLINE_MISMATCH",
  WORKER_NOT_ELIGIBLE: "WORKER_NOT_ELIGIBLE",
  WORKER_SCHEDULE_CONFLICT: "WORKER_SCHEDULE_CONFLICT",
};

export type FillState = "unfilled" | "partially_filled" | "filled";

export const FILL_STATE_LABELS: Record<FillState, string> = {
  unfilled: "Unfilled",
  partially_filled: "Partially filled",
  filled: "Filled",
};

/** Same derivation as the database projections. */
export function deriveFillState(activeCount: number, requestedHeadcount: number): FillState {
  if (activeCount <= 0) return "unfilled";
  return activeCount < requestedHeadcount ? "partially_filled" : "filled";
}

export function isFillState(value: string): value is FillState {
  return value === "unfilled" || value === "partially_filled" || value === "filled";
}

export const MAX_REQUESTED_HEADCOUNT = 100;

// -----------------------------------------------------------------------------
// Time: canonical instants are UTC (timestamptz); display is ALWAYS in the
// shift's own timezone, never the viewer's.
// -----------------------------------------------------------------------------
export type ShiftTimes = { startAt: string; endAt: string; timezone: string };

function formatter(timezone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...options });
}

/** e.g. "Tue, Oct 6, 2026". */
export function formatShiftDate({ startAt, timezone }: Pick<ShiftTimes, "startAt" | "timezone">) {
  return formatter(timezone, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(startAt));
}

/** e.g. "7:00 PM – 7:00 AM (+1 day) EDT". */
export function formatShiftTimeRange({ startAt, endAt, timezone }: ShiftTimes): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const time = formatter(timezone, { hour: "numeric", minute: "2-digit" });
  const zone =
    formatter(timezone, { timeZoneName: "short" })
      .formatToParts(start)
      .find((part) => part.type === "timeZoneName")?.value ?? timezone;
  // A shift ending exactly at midnight stays on its start day (as in the database).
  const dayDiff =
    localDayNumber(new Date(end.getTime() - 1), timezone) - localDayNumber(start, timezone);
  const suffix = dayDiff > 0 ? ` (+${dayDiff} day${dayDiff > 1 ? "s" : ""})` : "";
  return `${time.format(start)} – ${time.format(end)}${suffix} ${zone}`;
}

/** Elapsed duration in hours (DST-aware because it uses instants). */
export function shiftDurationHours({
  startAt,
  endAt,
}: Pick<ShiftTimes, "startAt" | "endAt">): number {
  return (new Date(endAt).getTime() - new Date(startAt).getTime()) / 3_600_000;
}

function localDayNumber(instant: Date, timezone: string): number {
  const parts = formatter(timezone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(value("year"), value("month") - 1, value("day")) / 86_400_000;
}

/** Local calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function localDate(instant: string, timezone: string): string {
  const parts = formatter(timezone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** Today's UTC date (YYYY-MM-DD); a lower bound for date pickers only. */
export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** True once the shift's end instant has passed. */
export function hasEnded({ endAt }: Pick<ShiftTimes, "endAt">): boolean {
  return new Date(endAt).getTime() <= Date.now();
}
