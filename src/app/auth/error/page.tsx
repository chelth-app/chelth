import type { Metadata } from "next";
import Link from "next/link";

import { AuthCanvas } from "@/components/layout/auth-canvas";
import {
  stateActionClass,
  stateSecondaryActionClass,
  SystemState,
} from "@/components/ui/system-state";
import { ERROR_CODES } from "@/lib/errors/error-codes";

export const metadata: Metadata = { title: "Link problem" };

export default function AuthErrorPage() {
  return (
    <AuthCanvas>
      <SystemState
        tone="error"
        title="We couldn't verify that link"
        description={ERROR_CODES.AUTH_LINK_INVALID.message}
        action={
          <>
            <Link href="/sign-in" className={stateActionClass}>
              Sign in
            </Link>
            <Link href="/forgot-password" className={stateSecondaryActionClass}>
              Request a new link
            </Link>
          </>
        }
      />
    </AuthCanvas>
  );
}
