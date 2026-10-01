import "server-only";

import { AppError, type ErrorCode } from "@/lib/errors";

/**
 * Sensitive financial actions (approvals, downloads) return a refusal instead
 * of raising, so the database can commit its audit row. Map it to the same
 * safe error a raised refusal would have produced.
 */
export function denialError(reason: string, notFound: ErrorCode): AppError {
  const code: ErrorCode =
    reason === "MFA_REQUIRED"
      ? "MFA_REQUIRED"
      : reason === "MAKER_CHECKER"
        ? "MAKER_CHECKER_REQUIRED"
        : reason === "NOT_PERMITTED"
          ? "FORBIDDEN"
          : notFound;
  return new AppError(code, { internalMessage: `Financial action refused: ${reason}` });
}

export function assertNotDenied(data: unknown, notFound: ErrorCode): void {
  const row = Array.isArray(data)
    ? (data[0] as { outcome?: string; reason_code?: string | null })
    : null;
  if (!row || row.outcome !== "approved") {
    throw denialError(row?.reason_code ?? "NOT_FOUND", notFound);
  }
}
