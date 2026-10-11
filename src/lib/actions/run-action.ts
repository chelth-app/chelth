import "server-only";

import { unstable_rethrow } from "next/navigation";

import { type ActionResult, fail, normalizeError, ok } from "@/lib/errors";
import { getRequestTerminology } from "@/lib/i18n/request-terms";
import { localizeTerms } from "@/lib/i18n/terminology";
import { logger } from "@/lib/logging";
import { getRequestId } from "@/lib/request-context";

/** State shape for forms driven by useActionState (null before first submit). */
export type ActionState<T = null> = ActionResult<T> | null;

/**
 * Runs a Server Action body with the Chelth error contract:
 * - Next.js control flow (redirect, notFound) passes through untouched;
 * - every other error is normalised to an AppError, logged with the request
 *   id (redacted), and returned as a safe ActionResult — never thrown raw.
 */
export async function runAction<T>(
  actionName: string,
  body: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return ok(await body());
  } catch (error) {
    unstable_rethrow(error);
    const appError = normalizeError(error);
    const context = {
      action: actionName,
      code: appError.code,
      requestId: getRequestId(),
      upstreamCode: appError.context?.upstreamCode,
    };
    if (appError.kind === "internal") logger.error("Server action failed", { ...context, error });
    else logger.info("Server action rejected", context);
    return localizeResult(fail(appError));
  }
}

/**
 * P0-E9-3I: user-facing error copy in the request's spelling (presentation
 * only; codes are unchanged). Falls back to the American source text.
 */
async function localizeResult<T>(result: ActionResult<T>): Promise<ActionResult<T>> {
  if (result.ok) return result;
  try {
    const terms = await getRequestTerminology();
    const spell = (text: string) => localizeTerms(text, terms);
    const { error } = result;
    return {
      ok: false,
      error: {
        ...error,
        message: spell(error.message),
        ...(error.fieldErrors
          ? {
              fieldErrors: Object.fromEntries(
                Object.entries(error.fieldErrors).map(([field, messages]) => [
                  field,
                  messages.map(spell),
                ]),
              ),
            }
          : {}),
      },
    };
  } catch {
    return result;
  }
}
