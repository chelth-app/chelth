import Link from "next/link";

import { AuthCanvas } from "@/components/layout/auth-canvas";
import { stateActionClass, SystemState } from "@/components/ui/system-state";

/** Unmatched routes and not-found outside any app frame (P9 canvas). */
export default function NotFound() {
  return (
    <AuthCanvas>
      <SystemState
        title="Page not found"
        description="The page you requested does not exist."
        action={
          <Link href="/" className={stateActionClass}>
            Return home
          </Link>
        }
      />
    </AuthCanvas>
  );
}
