"use client";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { ERROR_CODES } from "@/lib/errors/error-codes";

/**
 * Workspace error boundary (P9): the error renders inside the workspace shell,
 * so navigation stays available. Only the safe generic message and the digest
 * (support reference) are shown; the real error is logged server-side by
 * src/instrumentation.ts.
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="This page could not be loaded"
      message={ERROR_CODES.INTERNAL.message}
      reference={error.digest}
      action={
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
