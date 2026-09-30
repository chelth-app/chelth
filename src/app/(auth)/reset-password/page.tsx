import type { Metadata } from "next";
import Link from "next/link";

import { ErrorState } from "@/components/ui/error-state";
import { AuthCard, ResetPasswordForm } from "@/features/identity";
import { getAuthIdentity } from "@/lib/auth/session";
import { ERROR_CODES } from "@/lib/errors/error-codes";

export const metadata: Metadata = { title: "Choose a new password" };

/** Reached from the recovery email via /auth/confirm, which establishes the session. */
export default async function ResetPasswordPage() {
  const identity = await getAuthIdentity();
  return (
    <AuthCard title="Choose a new password">
      {identity ? (
        <ResetPasswordForm />
      ) : (
        <ErrorState
          title="Reset link required"
          message={ERROR_CODES.AUTH_LINK_INVALID.message}
          action={
            <Link
              href="/forgot-password"
              className="text-sm text-primary underline underline-offset-4"
            >
              Request a new link
            </Link>
          }
        />
      )}
    </AuthCard>
  );
}
