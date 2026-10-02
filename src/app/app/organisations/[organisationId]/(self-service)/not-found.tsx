import Link from "next/link";

import { stateActionClass, SystemState } from "@/components/ui/system-state";

/**
 * Not-found inside this frame (P9). Tenant-safe: the same words whether a
 * record does not exist or is not available to the caller, and the 404
 * status is unchanged.
 */
export default function FrameNotFound() {
  return (
    <SystemState
      title="Page not found"
      description="This page does not exist, or it is not available to you."
      action={
        <Link href="/app" className={stateActionClass}>
          Back to your workspaces
        </Link>
      }
    />
  );
}
