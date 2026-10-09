"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { stateSecondaryActionClass, SystemState } from "@/components/ui/system-state";
import { ERROR_CODES } from "@/lib/errors/error-codes";

/**
 * Error boundary inside this frame (P9), so navigation stays available. Only
 * the safe generic message and the digest (support reference) are shown; the
 * real error is logged server-side by src/instrumentation.ts.
 */
export default function PersonalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SystemState
      tone="error"
      title="This page could not be loaded"
      description={ERROR_CODES.INTERNAL.message}
      reference={error.digest}
      action={
        <>
          <Button onClick={reset}>Try again</Button>
          <Link href="/app" className={stateSecondaryActionClass}>
            Back to your workspaces
          </Link>
        </>
      }
    />
  );
}
