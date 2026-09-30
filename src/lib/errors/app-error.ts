import { ERROR_CODES, type ErrorCode, type ErrorKind } from "./error-codes";

export type FieldErrors = Readonly<Record<string, readonly string[]>>;

/**
 * The single application error type.
 *
 * - `code` / `kind` / `status` / `publicMessage` are safe to expose.
 * - `cause` and `context` are for logs only and are never serialised to users.
 */
export class AppError extends Error {
  override readonly name = "AppError";
  readonly code: ErrorCode;
  readonly kind: ErrorKind;
  readonly status: number;
  readonly publicMessage: string;
  readonly fieldErrors: FieldErrors | undefined;
  readonly context: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: ErrorCode,
    options: {
      /** Internal, log-only description. Defaults to the code. */
      internalMessage?: string;
      cause?: unknown;
      fieldErrors?: FieldErrors;
      context?: Record<string, unknown>;
    } = {},
  ) {
    super(options.internalMessage ?? code, { cause: options.cause });
    const definition = ERROR_CODES[code];
    this.code = code;
    this.kind = definition.kind;
    this.status = definition.status;
    this.publicMessage = definition.message;
    this.fieldErrors = options.fieldErrors;
    this.context = options.context;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** The only error shape that may be returned to a client. */
export type PublicError = {
  code: ErrorCode;
  message: string;
  fieldErrors?: FieldErrors;
};

export function toPublicError(error: AppError): PublicError {
  return error.fieldErrors
    ? { code: error.code, message: error.publicMessage, fieldErrors: error.fieldErrors }
    : { code: error.code, message: error.publicMessage };
}

/** Standard return type for Server Actions and service functions called from the UI. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: PublicError };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: AppError): ActionResult<never> {
  return { ok: false, error: toPublicError(error) };
}
