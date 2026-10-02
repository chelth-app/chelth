"use client";

import { AuthCanvas } from "@/components/layout/auth-canvas";
import { Button } from "@/components/ui/button";
import { SystemState } from "@/components/ui/system-state";
import { ERROR_CODES } from "@/lib/errors/error-codes";

/**
 * Route-level error boundary outside any app frame. Shows only a safe generic
 * message plus the error digest as a support reference; the real error is
 * logged server-side by src/instrumentation.ts.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AuthCanvas>
      <SystemState
        tone="error"
        title="Something went wrong"
        description={ERROR_CODES.INTERNAL.message}
        reference={error.digest}
        action={<Button onClick={reset}>Try again</Button>}
      />
    </AuthCanvas>
  );
}
