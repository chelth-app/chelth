/**
 * Next.js instrumentation hook.
 *
 * Server errors are reported through the application logger (redacted,
 * structured). When error monitoring (e.g. Sentry) is approved, register it as
 * a log sink in `register()` — call sites do not change.
 */
import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ serverEnv }, { setLogLevel }] = await Promise.all([
      import("@/config/env.server"),
      import("@/lib/logging"),
    ]);
    setLogLevel(serverEnv.LOG_LEVEL);
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { logger } = await import("@/lib/logging");
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest: unknown }).digest)
      : undefined;

  // Only the path and route metadata are logged — never headers, cookies,
  // query strings or bodies, which may contain tokens or personal data.
  logger.error("Unhandled request error", {
    error,
    digest,
    method: request.method,
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
  });
};
