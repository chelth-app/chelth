import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { AuthCard } from "@/features/identity";
import {
  AcceptInviteForm,
  dismissInviteAction,
  isInviteTokenFormat,
  previewInvite,
  readPendingInviteToken,
} from "@/features/organisations";
import { getAuthIdentity } from "@/lib/auth/session";
import { ERROR_CODES } from "@/lib/errors/error-codes";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitePage() {
  const [identity, token] = await Promise.all([getAuthIdentity(), readPendingInviteToken()]);

  if (!identity) {
    // Identical for valid, invalid and missing tokens.
    return (
      <AuthCard
        title="You have been invited to CHELTH"
        description="Sign in or create an account using the email address the invitation was sent to."
      >
        <div className="flex flex-wrap gap-3">
          <Link
            href="/sign-in?next=/invite"
            className="rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-md border border-input-border px-4 py-2.5 text-sm font-medium"
          >
            Create account
          </Link>
        </div>
      </AuthCard>
    );
  }

  const preview = isInviteTokenFormat(token) ? await previewInvite(token) : null;

  return (
    <AuthCard title="Invitation">
      {preview ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            You have been invited to join <strong>{preview.organisationName}</strong> as{" "}
            <strong>{preview.roleName}</strong>.
          </p>
          <AcceptInviteForm />
        </div>
      ) : (
        <ErrorState
          title="Invitation unavailable"
          message={ERROR_CODES.INVITE_INVALID.message}
          action={
            <form action={dismissInviteAction}>
              <Button type="submit" variant="outline" size="sm">
                Continue to CHELTH
              </Button>
            </form>
          }
        />
      )}
    </AuthCard>
  );
}
