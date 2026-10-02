import type { Metadata } from "next";
import Link from "next/link";

import { AuthCanvas } from "@/components/layout/auth-canvas";
import { stateActionClass, SystemState } from "@/components/ui/system-state";
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
            <Link
              href="/forgot-password"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-input-border bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-muted"
            >
              Request a new link
            </Link>
          </>
        }
      />
    </AuthCanvas>
  );
}
