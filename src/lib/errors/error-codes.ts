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
