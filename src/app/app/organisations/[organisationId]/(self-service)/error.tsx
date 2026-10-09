"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { stateSecondaryActionClass, SystemState } from "@/components/ui/system-state";
import { ERROR_CODES } from "@/lib/errors/error-codes";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Error boundary inside this frame (P9), so navigation stays available. Only
 * the safe generic message and the digest (support reference) are shown; the
 * real error is logged server-side by src/instrumentation.ts. Offline (P0-E9-3C:
 * the installed app), it says so plainly: nothing was saved or queued.
 */
export default function WorkerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const offline = useSyncExternalStore(
    subscribe,
    () => !navigator.onLine,
    () => false,
  );
  return (
    <SystemState
      tone="error"
      title={offline ? "You're offline" : "This page could not be loaded"}
      description={
        offline
          ? "Nothing was saved. Connect to the internet, then try again."
          : ERROR_CODES.INTERNAL.message
      }
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
