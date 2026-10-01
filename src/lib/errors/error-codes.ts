/**
 * Error code registry.
 *
 * Every error surfaced to a user maps to one of these codes. The `message` is
 * the only text a user ever sees; it must be safe (no database, stack or
 * infrastructure detail). Add new codes here rather than inventing ad-hoc
 * strings at call sites. Codes are stable identifiers: never rename one that
 * has shipped — clients and support tooling may depend on it.
 */

export const ERROR_KINDS = [
  "validation",
  "authentication",
  "authorization",
  "not_found",
  "conflict",
  "rate_limited",
  "internal",
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

type ErrorDefinition = {
  kind: ErrorKind;
  /** HTTP status used when the error crosses an HTTP boundary. */
  status: number;
  /** Safe, user-facing message. */
  message: string;
};

export const ERROR_CODES = {
  VALIDATION_FAILED: {
    kind: "validation",
    status: 400,
    message: "Some of the information provided is invalid. Please check and try again.",
  },
  AUTH_REQUIRED: {
    kind: "authentication",
    status: 401,
    message: "Please sign in to continue.",
  },
  AUTH_SESSION_EXPIRED: {
    kind: "authentication",
    status: 401,
    message: "Your session has expired. Please sign in again.",
  },
  AUTH_INVALID_CREDENTIALS: {
    kind: "authentication",
    status: 401,
    message: "The email address or password is incorrect.",
  },
  AUTH_EMAIL_NOT_VERIFIED: {
    kind: "authentication",
    status: 403,
    message: "Please verify your email address using the link we sent you, then sign in.",
  },
  MFA_REQUIRED: {
    kind: "authentication",
    status: 403,
    message: "This action requires verification with your authenticator app.",
  },
  MFA_CODE_INVALID: {
    kind: "authentication",
    status: 400,
    message: "That code is not valid. Check your authenticator app and try again.",
  },
  AUTH_LINK_INVALID: {
    kind: "authentication",
    status: 400,
    message: "This link is invalid or has expired. Please request a new one.",
  },
  FORBIDDEN: {
    kind: "authorization",
    status: 403,
    message: "You do not have permission to perform this action.",
  },
  NOT_FOUND: {
    kind: "not_found",
    status: 404,
    message: "The requested item could not be found.",
  },
  CONFLICT: {
    kind: "conflict",
    status: 409,
    message: "This change conflicts with the current state. Please refresh and try again.",
  },
  INVALID_STATE_TRANSITION: {
    kind: "conflict",
    status: 409,
    message: "This action is not allowed in the item's current state.",
  },
  INVITE_INVALID: {
    kind: "not_found",
    status: 404,
    message:
      "This invitation is invalid, has expired, has already been used, or was sent to a different email address.",
  },
  WORKER_NOT_FOUND: {
    kind: "not_found",
    status: 404,
    message: "That worker record could not be found.",
  },
  FACILITY_NOT_FOUND: {
    kind: "not_found",
    status: 404,
    message: "That facility could not be found.",
  },
  RELATIONSHIP_NOT_FOUND: {
    kind: "not_found",
    status: 404,
    message: "That relationship could not be found.",
  },
  INVALID_WORKER_STATE: {
    kind: "conflict",
    status: 409,
    message: "This change is not allowed for the worker's current status.",
  },
  INVALID_RELATIONSHIP_STATE: {
    kind: "conflict",
    status: 409,
    message: "This change is not allowed for the relationship's current status.",
  },
  SHIFT_NOT_FOUND: {
    kind: "not_found",
    status: 404,
    message: "That shift could not be found.",
  },
  SHIFT_NOT_OPEN: {
    kind: "conflict",
    status: 409,
    message: "This shift is not open.",
  },
  RELATIONSHIP_NOT_ACTIVE: {
    kind: "conflict",
    status: 409,
    message: "The agency–facility relationship is not active.",
  },
  FACILITY_LOCATION_INVALID: {
    kind: "validation",
    status: 400,
    message: "Choose an active location of this facility.",
  },
  DISCIPLINE_MISMATCH: {
    kind: "conflict",
    status: 409,
    message: "This worker does not hold the discipline the shift requires.",
  },
  WORKER_NOT_ACTIVE: {
    kind: "conflict",
    status: 409,
    message: "This worker is not active.",
  },
  WORKER_NOT_ELIGIBLE: {
    kind: "conflict",
    status: 409,
    message: "This worker is not compliant for this facility on the shift date.",
  },
  WORKER_SCHEDULE_CONFLICT: {
    kind: "conflict",
    status: 409,
    message: "This worker has a scheduling conflict at that time.",
  },
  SHIFT_FULL: {
    kind: "conflict",
    status: 409,
    message: "This shift is already fully staffed.",
  },
  ASSIGNMENT_ALREADY_EXISTS: {
    kind: "conflict",
    status: 409,
    message: "This worker is already assigned to this shift.",
  },
  ASSIGNMENT_NOT_FOUND: {
    kind: "not_found",
    status: 404,
    message: "That assignment could not be found.",
  },
  ASSIGNMENT_NOT_ACTIONABLE: {
    kind: "conflict",
    status: 409,
    message: "This assignment can no longer be changed.",
  },
  OFFER_NOT_FOUND: {
    kind: "not_found",
    status: 404,
    message: "That shift offer could not be found.",
  },
  OFFER_NOT_ACTIONABLE: {
    kind: "conflict",
    status: 409,
    message: "This offer is no longer open.",
  },
  OFFER_EXPIRED: {
    kind: "conflict",
    status: 409,
    message: "This offer has expired.",
  },
  ATTENDANCE_NOT_FOUND: {
    kind: "not_found",
    status: 404,
    message: "That attendance record could not be found.",
  },
  ASSIGNMENT_NOT_ACCEPTED: {
    kind: "conflict",
    status: 409,
    message: "Accept the assignment before clocking in.",
  },
  SHIFT_CANCELLED: {
    kind: "conflict",
    status: 409,
    message: "This shift has been cancelled.",
  },
  TOO_EARLY_TO_CLOCK_IN: {
    kind: "conflict",
    status: 409,
    message: "It is too early to clock in for this shift.",
  },
  TOO_LATE_TO_CLOCK_IN: {
    kind: "conflict",
    status: 409,
    message: "This shift has ended. Request a correction if you worked it.",
  },
  ALREADY_CLOCKED_IN: {
    kind: "conflict",
    status: 409,
    message: "You are already clocked in.",
  },
  NOT_CLOCKED_IN: {
    kind: "conflict",
    status: 409,
    message: "You are not clocked in for this shift.",
  },
  ALREADY_CLOCKED_OUT: {
    kind: "conflict",
    status: 409,
    message: "You have already clocked out.",
  },
  GEOFENCE_REQUIRED: {
    kind: "validation",
    status: 400,
    message: "This site needs your location to record attendance.",
  },
  LOCATION_UNAVAILABLE: {
    kind: "validation",
    status: 400,
    message: "Your location could not be determined. Check location permissions and try again.",
  },
  LOCATION_ACCURACY_TOO_LOW: {
    kind: "validation",
    status: 400,
    message: "Your location is not accurate enough. Move to an open area and try again.",
  },
  OUTSIDE_GEOFENCE: {
    kind: "conflict",
    status: 409,
    message:
      "You appear to be outside the site area. Your agency has been told; contact them if you are on site.",
  },
  CORRECTION_NOT_ALLOWED: {
    kind: "conflict",
    status: 409,
    message: "This correction cannot be requested.",
  },
  CORRECTION_ALREADY_REVIEWED: {
    kind: "conflict",
    status: 409,
    message: "This correction has already been reviewed.",
  },
  CLOCK_OUT_WINDOW_CLOSED: {
    kind: "conflict",
    status: 409,
    message: "The clock-out window has closed. Request a correction instead.",
  },
  ALREADY_ON_BREAK: {
    kind: "conflict",
    status: 409,
    message: "You are already on a break.",
  },
  NOT_ON_BREAK: {
    kind: "conflict",
    status: 409,
    message: "You are not on a break.",
  },
  ON_BREAK: {
    kind: "conflict",
    status: 409,
    message: "End your break before clocking out.",
  },
  TIMESHEET_REVISION_REQUIRED: {
    kind: "conflict",
    status: 409,
    message:
      "This time is on an approved timesheet. Confirm that you want to create a new revision for re-approval.",
  },
  TIMESHEET_NOT_FOUND: {
    kind: "not_found",
    status: 404,
    message: "That timesheet could not be found.",
  },
  TIMESHEET_NOT_ACTIONABLE: {
    kind: "conflict",
    status: 409,
    message: "This timesheet cannot be changed in its current state.",
  },
  TIMESHEET_NOT_READY: {
    kind: "conflict",
    status: 409,
    message: "This timesheet still has items to resolve.",
  },
  TIMESHEET_ENTRY_NOT_FOUND: {
    kind: "not_found",
    status: 404,
    message: "That timesheet entry could not be found.",
  },
  SIGNOFF_NOT_ACTIONABLE: {
    kind: "conflict",
    status: 409,
    message: "This entry is not awaiting sign-off.",
  },
  TIMESHEET_REVISION_CONFLICT: {
    kind: "conflict",
    status: 409,
    message: "This timesheet changed while you were viewing it. Reload and review it again.",
  },
  TIMESHEET_SETTINGS_LOCKED: {
    kind: "conflict",
    status: 409,
    message: "The timesheet week is fixed once timesheets exist.",
  },
  RATE_NOT_CONFIGURED: {
    kind: "conflict",
    status: 409,
    message: "No active rate covers this work. Add or activate a rate, then price again.",
  },
  RATE_AMBIGUOUS: {
    kind: "conflict",
    status: 409,
    message: "More than one rate matches this work. Pricing was stopped.",
  },
  RATE_NOT_ACTIVE: {
    kind: "conflict",
    status: 409,
    message: "Only a draft rate version can be changed.",
  },
  RATE_NOT_FOUND: {
    kind: "not_found",
    status: 404,
    message: "That rate could not be found.",
  },
  RATE_CURRENCY_MISMATCH: {
    kind: "conflict",
    status: 409,
    message:
      "The rates for this timesheet use different currencies, or the currency is not supported.",
  },
  TIMESHEET_NOT_LOCKED: {
    kind: "conflict",
    status: 409,
    message: "Only a locked timesheet can be priced.",
  },
  TIMESHEET_REVISION_CHANGED: {
    kind: "conflict",
    status: 409,
    message: "The timesheet changed. Reload it before pricing.",
  },
  INVALID_RATE: {
    kind: "validation",
    status: 400,
    message: "Enter pay and bill rates greater than zero.",
  },
  INVALID_EFFECTIVE_PERIOD: {
    kind: "validation",
    status: 400,
    message: "The end date must be on or after the start date.",
  },
  OVERLAPPING_RATE_VERSION: {
    kind: "conflict",
    status: 409,
    message: "This version would overlap an existing active version. Choose a later start date.",
  },
  ROUNDING_POLICY_INVALID: {
    kind: "validation",
    status: 400,
    message: "Choose no rounding, or rounding to 5, 6, 10 or 15 minutes.",
  },
  OVERTIME_POLICY_INVALID: {
    kind: "validation",
    status: 400,
    message: "Enter a weekly threshold and a multiplier of at least 1×.",
  },
  PRICING_NOT_FOUND: {
    kind: "not_found",
    status: 404,
    message: "That pricing record could not be found.",
  },
  PAYROLL_NOTHING_TO_PREPARE: {
    kind: "conflict",
    status: 409,
    message: "No priced work is ready for this payroll period and currency.",
  },
  FINANCIAL_SOURCE_SUPERSEDED: {
    kind: "conflict",
    status: 409,
    message:
      "Some included work has been revised since this was prepared. Cancel it and prepare it again.",
  },
  FINANCIAL_DOCUMENT_LOCKED: {
    kind: "conflict",
    status: 409,
    message: "This record is locked and cannot be changed.",
  },
  INVALID_FINANCIAL_TRANSITION: {
    kind: "conflict",
    status: 409,
    message: "This step is not available in the current status. Refresh and try again.",
  },
  PAYROLL_PERIOD_INVALID: {
    kind: "validation",
    status: 400,
    message: "Choose the start date of a payroll period that does not overlap an existing one.",
  },
  PAYROLL_BATCH_NOT_FOUND: {
    kind: "not_found",
    status: 404,
    message: "That payroll batch could not be found.",
  },
  INVOICE_DRAFT_NOT_FOUND: {
    kind: "not_found",
    status: 404,
    message: "That invoice draft could not be found.",
  },
  FINANCIAL_EXPORT_NOT_FOUND: {
    kind: "not_found",
    status: 404,
    message: "That export could not be found.",
  },
  INVOICE_NOTHING_TO_DRAFT: {
    kind: "conflict",
    status: 409,
    message: "No billable priced work is ready for this facility, week and currency.",
  },
  FINANCIAL_LINE_ALREADY_INCLUDED: {
    kind: "conflict",
    status: 409,
    message: "Some of this work was just included elsewhere. Refresh and try again.",
  },
  RATE_LIMITED: {
    kind: "rate_limited",
    status: 429,
    message: "Too many attempts. Please wait a moment and try again.",
  },
  INTERNAL: {
    kind: "internal",
    status: 500,
    message: "Something went wrong on our side. Please try again.",
  },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_CODES;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_CODES, value);
}
