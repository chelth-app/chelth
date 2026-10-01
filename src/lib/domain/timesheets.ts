/**
 * Timesheet vocabulary (P0-E6-S2).
 *
 * Timesheets summarise attendance; every time value is derived by the
 * database (internal.effective_time). These labels and helpers are
 * presentation only. No pay, rate or overtime concept exists here.
 */
import { Constants, type Database } from "@/types/database.types";

type Enums = Database["public"]["Enums"];

export type TimesheetStatus = Enums["timesheet_status"];
export type TimesheetFacilityState = Enums["timesheet_facility_state"];
export type TimesheetRejectionReason = Enums["timesheet_rejection_reason"];
export type TimesheetDisputeReason = Enums["timesheet_dispute_reason"];
export type TimesheetReopenReason = Enums["timesheet_reopen_reason"];
export type TimesheetHistoryAction = Enums["timesheet_history_action"];

export const TIMESHEET_STATUSES = Constants.public.Enums.timesheet_status;
export const TIMESHEET_REJECTION_REASONS = Constants.public.Enums.timesheet_rejection_reason;
export const TIMESHEET_DISPUTE_REASONS = Constants.public.Enums.timesheet_dispute_reason;
export const TIMESHEET_REOPEN_REASONS = Constants.public.Enums.timesheet_reopen_reason;

export const TIMESHEET_STATUS_LABELS: Record<TimesheetStatus, string> = {
  open: "Open",
  submitted: "Submitted",
  rejected: "Returned",
  agency_approved: "Approved, awaiting facility",
  locked: "Locked",
};

export const FACILITY_STATE_LABELS: Record<TimesheetFacilityState, string> = {
  not_required: "No sign-off needed",
  pending: "Awaiting sign-off",
  signed_off: "Signed off",
  disputed: "Discrepancy raised",
};

export const REJECTION_REASON_LABELS: Record<TimesheetRejectionReason, string> = {
  attendance_incorrect: "Attendance looks incorrect",
  missing_information: "Information missing",
  facility_discrepancy: "Facility discrepancy",
  other: "Other",
};

export const DISPUTE_REASON_LABELS: Record<TimesheetDisputeReason, string> = {
  worker_not_present: "Worker was not present",
  time_incorrect: "Times are incorrect",
  break_incorrect: "Break is incorrect",
  assignment_not_worked: "Shift was not worked",
  other: "Other",
};

export const REOPEN_REASON_LABELS: Record<TimesheetReopenReason, string> = {
  facility_discrepancy: "Facility discrepancy",
  attendance_changed: "Attendance changed",
  approved_in_error: "Approved in error",
  other: "Other",
};

export const HISTORY_ACTION_LABELS: Record<TimesheetHistoryAction, string> = {
  submitted: "Submitted",
  rejected: "Returned to worker",
  agency_approved: "Approved by agency",
  facility_signed_off: "Signed off by facility",
  facility_disputed: "Discrepancy raised by facility",
  dispute_resolved: "Discrepancy answered: times confirmed",
  locked: "Locked",
  reopened: "Reopened",
  revised: "New revision after an attendance change",
  facility_signoff_not_required: "Facility sign-off no longer required (relationship ended)",
};

/**
 * Reasons a timesheet cannot be submitted (worker) or approved (agency).
 * Codes come from internal.timesheet_blocking.
 */
export const BLOCKING_REASON_LABELS: Record<string, string> = {
  MISSING_CLOCK_IN: "A shift has no clock-in",
  MISSING_CLOCK_OUT: "A shift has no clock-out",
  BREAK_NOT_ENDED: "A break was not ended",
  TIMES_INCONSISTENT: "Recorded times are out of order",
  PENDING_CORRECTION: "A correction request is waiting for review",
  PERIOD_NOT_ENDED: "The week has not ended yet",
  NO_WORK: "There is no work in this week",
  UNREVIEWED_EXCEPTION: "An attendance exception has not been reviewed",
};

export function blockingReasonLabel(code: string): string {
  return BLOCKING_REASON_LABELS[code] ?? code;
}

/** What the worker can do about a reason (none for agency-only reasons). */
export const BLOCKING_REASON_HELP: Record<string, string> = {
  MISSING_CLOCK_IN: "Request a correction with the time you started, or ask your agency.",
  MISSING_CLOCK_OUT: "Request a correction with the time you finished.",
  BREAK_NOT_ENDED: "Request a correction with the time your break ended.",
  PENDING_CORRECTION: "Your agency will review it; you can submit afterwards.",
  PERIOD_NOT_ENDED: "You can submit once the week is over.",
};

/** "7 h 33 min" — whole minutes only. Never hours as decimals, never money. */
export function formatWorkedMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "Mon, Mar 4 – Sun, Mar 10, 2030" for a period of calendar dates. */
export function formatPeriod(periodStart: string, periodEnd: string): string {
  const format = (value: string, withYear: boolean) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
    }).format(new Date(`${value}T00:00:00Z`));
  return `${format(periodStart, false)} – ${format(periodEnd, true)}`;
}

/** ISO weekday (1 = Monday … 7 = Sunday) labels for the week-start setting. */
export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

/**
 * Period start for a local date, mirroring internal.period_start_for (for
 * display and filters only; the database assigns entries to periods).
 */
export function periodStartFor(localDate: string, weekStartsOn: number): string {
  const date = new Date(`${localDate}T00:00:00Z`);
  const isoDow = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  const offset = (isoDow - weekStartsOn + 7) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}
