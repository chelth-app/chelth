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
export type ShiftOfferStatus = Enums["shift_offer_status"];
export type ShiftOfferCloseReason = Enums["shift_offer_close_reason"];
export type AssignmentIssueType = Enums["assignment_issue_type"];
export type AssignmentIssueSeverity = Enums["assignment_issue_severity"];
export type AssignmentIssueStatus = Enums["assignment_issue_status"];
export type AssignmentIssueSource = Enums["assignment_issue_source"];

export const SHIFT_STATUSES = Constants.public.Enums.shift_status;
export const SHIFT_SOURCES = Constants.public.Enums.shift_source;
/** Reasons a person may choose; relationship_ended is set only by ending a relationship. */
export const SHIFT_CANCELLATION_REASONS = Constants.public.Enums.shift_cancellation_reason.filter(
  (reason): reason is Exclude<ShiftCancellationReason, "relationship_ended"> =>
    reason !== "relationship_ended",
);
export const ASSIGNMENT_STATUSES = Constants.public.Enums.assignment_status;
export const ASSIGNMENT_BLOCK_REASONS = Constants.public.Enums.assignment_block_reason;
export const SHIFT_OFFER_STATUSES = Constants.public.Enums.shift_offer_status;
export const ASSIGNMENT_ISSUE_TYPES = Constants.public.Enums.assignment_issue_type;
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
  relationship_ended: "Relationship ended",
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

/**
 * Splits a discipline display name such as "Certified Nursing Assistant (CNA)"
 * into its name and short code, for the locked layouts that show them apart.
 * Names without a trailing "(CODE)" are returned whole with no code.
 */
export function disciplineNameParts(name: string): { name: string; code: string | null } {
  const match = /^(.*\S)\s*\(([^()]+)\)$/.exec(name);
  return match?.[1] && match[2] ? { name: match[1], code: match[2] } : { name, code: null };
}

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
export function formatShiftTimeRange(times: ShiftTimes): string {
  const { range, zone } = formatShiftTimeRangeParts(times);
  return `${range} ${zone}`;
}

/** The time range and its timezone abbreviation, for layouts that set them apart. */
export function formatShiftTimeRangeParts({ startAt, endAt, timezone }: ShiftTimes): {
  range: string;
  zone: string;
} {
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
  return { range: `${time.format(start)} – ${time.format(end)}${suffix}`, zone };
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

// -----------------------------------------------------------------------------
// Offers and assignment issues (P0-E5-S2)
// -----------------------------------------------------------------------------
export const SHIFT_OFFER_STATUS_LABELS: Record<ShiftOfferStatus, string> = {
  offered: "Offered",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  cancelled: "Closed",
};

export const SHIFT_OFFER_CLOSE_REASON_LABELS: Record<ShiftOfferCloseReason, string> = {
  shift_filled: "Shift filled",
  shift_cancelled: "Shift cancelled",
  shift_closed: "Shift closed",
  withdrawn: "Withdrawn",
  relationship_not_active: "Relationship not active",
  assigned_directly: "Assigned directly",
};

/** Offer expiry choices (minutes). The server bounds 15 min – 7 days and never past the shift start. */
export const OFFER_EXPIRY_OPTIONS: readonly { minutes: number; label: string }[] = [
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
  { minutes: 720, label: "12 hours" },
  { minutes: 1440, label: "24 hours" },
  { minutes: 4320, label: "3 days" },
];

export const MAX_OFFER_RECIPIENTS = 50;

export const ASSIGNMENT_ISSUE_TYPE_LABELS: Record<AssignmentIssueType, string> = {
  not_eligible: "No longer eligible",
  relationship_not_active: "Facility relationship not active",
};

export const ASSIGNMENT_ISSUE_SEVERITY_LABELS: Record<AssignmentIssueSeverity, string> = {
  attention: "Needs attention",
  urgent: "Urgent",
};

/** True once the shift's start instant has passed. */
export function hasStarted({ startAt }: Pick<ShiftTimes, "startAt">): boolean {
  return new Date(startAt).getTime() <= Date.now();
}

/** The shift starts on today's date in its own facility timezone. */
export function startsLocalToday({
  startAt,
  timezone,
}: Pick<ShiftTimes, "startAt" | "timezone">): boolean {
  return localDate(startAt, timezone) === localDate(new Date().toISOString(), timezone);
}

/** Whole days from today (UTC) until an ISO date (YYYY-MM-DD); negative once past. */
export function daysUntilDate(isoDate: string): number {
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - today) / 86_400_000);
}

/** The shift starts within the next `hours` (or has already started). */
export function startsWithin({ startAt }: Pick<ShiftTimes, "startAt">, hours: number): boolean {
  return new Date(startAt).getTime() <= Date.now() + hours * 3_600_000;
}

// -----------------------------------------------------------------------------
// Worker shift periods and context (P0-E9-3D-S2)
// -----------------------------------------------------------------------------
export type ShiftPeriod = "today" | "upcoming" | "past";

/**
 * Today / Upcoming / Past for the worker, in the facility's local calendar:
 * today = starts on the facility's current date, or is in progress (a night
 * shift that began yesterday); upcoming = a later local date; past = earlier
 * and over. `now` comes from the server render, never the client.
 */
export function shiftPeriod(
  { startAt, endAt, timezone }: ShiftTimes,
  now: Date = new Date(),
): ShiftPeriod {
  const today = localDate(now.toISOString(), timezone);
  const day = localDate(startAt, timezone);
  const started = new Date(startAt).getTime() <= now.getTime();
  const ended = new Date(endAt).getTime() <= now.getTime();
  if (day === today || (started && !ended)) return "today";
  return day > today ? "upcoming" : "past";
}

/** "8 hours", "7 h 30 min" — scheduled length, for the shift header. */
export function formatShiftLength({ startAt, endAt }: Pick<ShiftTimes, "startAt" | "endAt">) {
  const minutes = Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return hours === 1 ? "1 hour" : `${hours} hours`;
  return hours === 0 ? `${rest} min` : `${hours} h ${rest} min`;
}

export type ShiftAddress = {
  line1: string | null;
  line2: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
};

/** Street line and "City, Region Postcode" for display. */
export function formatAddressLines(address: ShiftAddress): string[] {
  const street = [address.line1, address.line2].filter(Boolean).join(", ");
  const place = [address.locality, [address.region, address.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [street, place].filter(Boolean);
}

/** Destination-only query for map apps: the address, nothing about the worker or shift. */
export function directionsDestination(address: ShiftAddress, facilityName: string): string {
  const lines = formatAddressLines(address);
  return [...(lines.length ? lines : [facilityName]), address.countryCode]
    .filter(Boolean)
    .join(", ");
}
