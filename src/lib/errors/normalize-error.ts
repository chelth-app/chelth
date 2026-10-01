import { AppError, isAppError } from "./app-error";
import type { ErrorCode } from "./error-codes";

/**
 * Postgres SQLSTATE → application error code.
 *
 * Chelth convention for database functions (RPCs): raise application errors
 * with a custom SQLSTATE in class "CH", e.g.
 *   raise exception 'shift is not open' using errcode = 'CH409';
 * so the mapping below is explicit and never depends on parsing messages.
 */
const SQLSTATE_TO_CODE: Readonly<Record<string, ErrorCode>> = {
  "23505": "CONFLICT", // unique_violation
  "23503": "CONFLICT", // foreign_key_violation
  "23P01": "CONFLICT", // exclusion_violation
  "23514": "VALIDATION_FAILED", // check_violation
  "23502": "VALIDATION_FAILED", // not_null_violation
  "22P02": "VALIDATION_FAILED", // invalid_text_representation
  "42501": "FORBIDDEN", // insufficient_privilege (includes RLS rejections on write)
  "40001": "CONFLICT", // serialization_failure
  CH400: "VALIDATION_FAILED",
  CH401: "AUTH_REQUIRED",
  CH402: "MFA_REQUIRED", // privileged capability held, session is not AAL2
  CH403: "FORBIDDEN",
  CH404: "NOT_FOUND",
  CH409: "INVALID_STATE_TRANSITION",
  CH410: "INVITE_INVALID",
  CHW04: "WORKER_NOT_FOUND",
  CHW09: "INVALID_WORKER_STATE",
  CHF04: "FACILITY_NOT_FOUND",
  CHF09: "INVALID_STATE_TRANSITION",
  CHR04: "RELATIONSHIP_NOT_FOUND",
  CHR09: "INVALID_RELATIONSHIP_STATE",
  CH429: "RATE_LIMITED",
  CHS04: "SHIFT_NOT_FOUND",
  CHS09: "SHIFT_NOT_OPEN",
  CHS10: "RELATIONSHIP_NOT_ACTIVE",
  CHS11: "FACILITY_LOCATION_INVALID",
  CHS12: "DISCIPLINE_MISMATCH",
  CHS13: "WORKER_NOT_ACTIVE",
  CHS14: "WORKER_NOT_ELIGIBLE",
  CHS15: "WORKER_SCHEDULE_CONFLICT",
  CHS16: "SHIFT_FULL",
  CHA04: "ASSIGNMENT_NOT_FOUND",
  CHA09: "ASSIGNMENT_NOT_ACTIONABLE",
  CHO04: "OFFER_NOT_FOUND",
  CHO09: "OFFER_NOT_ACTIONABLE",
  CHO10: "OFFER_EXPIRED",
  CHT04: "ATTENDANCE_NOT_FOUND",
  CHT05: "ASSIGNMENT_NOT_ACCEPTED",
  CHT06: "SHIFT_CANCELLED",
  CHT07: "TOO_EARLY_TO_CLOCK_IN",
  CHT08: "TOO_LATE_TO_CLOCK_IN",
  CHT09: "ALREADY_CLOCKED_IN",
  CHT10: "NOT_CLOCKED_IN",
  CHT11: "ALREADY_CLOCKED_OUT",
  CHT12: "GEOFENCE_REQUIRED",
  CHT13: "LOCATION_UNAVAILABLE",
  CHT14: "LOCATION_ACCURACY_TOO_LOW",
  CHT15: "OUTSIDE_GEOFENCE",
  CHT16: "CORRECTION_NOT_ALLOWED",
  CHT17: "CORRECTION_ALREADY_REVIEWED",
  CHT18: "CLOCK_OUT_WINDOW_CLOSED",
  CHT19: "ALREADY_ON_BREAK",
  CHT20: "NOT_ON_BREAK",
  CHT21: "ON_BREAK",
  CHT22: "TIMESHEET_REVISION_REQUIRED",
  CHP04: "TIMESHEET_NOT_FOUND",
  CHP09: "TIMESHEET_NOT_ACTIONABLE",
  CHP12: "TIMESHEET_ENTRY_NOT_FOUND",
  CHP13: "SIGNOFF_NOT_ACTIONABLE",
  CHP14: "TIMESHEET_REVISION_CONFLICT",
  CHP15: "TIMESHEET_SETTINGS_LOCKED",
  CHM01: "RATE_NOT_CONFIGURED",
  CHM02: "RATE_AMBIGUOUS",
  CHM03: "RATE_NOT_ACTIVE",
  CHM04: "RATE_NOT_FOUND",
  CHM06: "RATE_CURRENCY_MISMATCH",
  CHM07: "TIMESHEET_NOT_LOCKED",
  CHM08: "TIMESHEET_REVISION_CHANGED",
  CHM10: "INVALID_RATE",
  CHM11: "INVALID_EFFECTIVE_PERIOD",
  CHM12: "OVERLAPPING_RATE_VERSION",
  CHM13: "ROUNDING_POLICY_INVALID",
  CHM14: "OVERTIME_POLICY_INVALID",
  CHM15: "PRICING_NOT_FOUND",
};

/** Supabase Auth error codes (AuthError.code). */
const AUTH_TO_CODE: Readonly<Record<string, ErrorCode>> = {
  invalid_credentials: "AUTH_INVALID_CREDENTIALS",
  email_not_confirmed: "AUTH_EMAIL_NOT_VERIFIED",
  session_not_found: "AUTH_SESSION_EXPIRED",
  session_expired: "AUTH_SESSION_EXPIRED",
  refresh_token_not_found: "AUTH_SESSION_EXPIRED",
  otp_expired: "AUTH_LINK_INVALID",
  mfa_verification_failed: "MFA_CODE_INVALID",
  mfa_challenge_expired: "MFA_CODE_INVALID",
  insufficient_aal: "MFA_REQUIRED",
  weak_password: "VALIDATION_FAILED",
  same_password: "VALIDATION_FAILED",
  over_request_rate_limit: "RATE_LIMITED",
  over_email_send_rate_limit: "RATE_LIMITED",
  reauthentication_needed: "AUTH_SESSION_EXPIRED",
};

/** PostgREST-specific codes. */
const POSTGREST_TO_CODE: Readonly<Record<string, ErrorCode>> = {
  PGRST116: "NOT_FOUND", // .single() returned no rows
  PGRST301: "AUTH_SESSION_EXPIRED", // JWT expired / invalid
  PGRST302: "AUTH_REQUIRED",
};

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "number" ? field : undefined;
}

function codeFromStatus(status: number | undefined): ErrorCode | undefined {
  switch (status) {
    case 401:
      return "AUTH_REQUIRED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 429:
      return "RATE_LIMITED";
    default:
      return undefined;
  }
}

/**
 * Converts any thrown value (PostgrestError, AuthError, Error, unknown) into
 * an AppError. The original value is preserved as `cause` for logging only.
 * Unknown errors become INTERNAL — never leak their message to users.
 */
export function normalizeError(error: unknown): AppError {
  if (isAppError(error)) return error;

  const code = readString(error, "code");
  const status = readNumber(error, "status");

  const mapped =
    (code !== undefined
      ? (SQLSTATE_TO_CODE[code] ?? POSTGREST_TO_CODE[code] ?? AUTH_TO_CODE[code])
      : undefined) ??
    codeFromStatus(status) ??
    "INTERNAL";

  return new AppError(mapped, {
    cause: error,
    internalMessage: error instanceof Error ? error.message : readString(error, "message"),
    context: code !== undefined ? { upstreamCode: code } : undefined,
  });
}
