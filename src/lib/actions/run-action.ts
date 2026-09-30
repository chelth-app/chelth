import "server-only";

import { unstable_rethrow } from "next/navigation";

import { type ActionResult, fail, normalizeError, ok } from "@/lib/errors";
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
    return fail(appError);
  }
}
