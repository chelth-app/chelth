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
  CH403: "FORBIDDEN",
  CH404: "NOT_FOUND",
  CH409: "INVALID_STATE_TRANSITION",
  CH429: "RATE_LIMITED",
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
    (code !== undefined ? (SQLSTATE_TO_CODE[code] ?? POSTGREST_TO_CODE[code]) : undefined) ??
    codeFromStatus(status) ??
    "INTERNAL";

  return new AppError(mapped, {
    cause: error,
    internalMessage: error instanceof Error ? error.message : readString(error, "message"),
    context: code !== undefined ? { upstreamCode: code } : undefined,
  });
}
