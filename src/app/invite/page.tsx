import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { KeyValueList } from "@/components/ui/key-value-list";
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

const expiry = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default async function InvitePage() {
  const [identity, token] = await Promise.all([getAuthIdentity(), readPendingInviteToken()]);

  if (!identity) {
    // Identical for valid, invalid and missing tokens.
    return (
      <AuthCard
        title="You have been invited to CHELTH"
        description="Sign in or create an account using the email address the invitation was sent to."
      >
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
          <li>Sign in, or create an account with the invited email address.</li>
          <li>Verify your email if you are new to CHELTH.</li>
          <li>Review the invitation and accept it.</li>
        </ol>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/sign-in?next=/invite"
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-input-border bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-muted"
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
          <KeyValueList
            className="rounded-md bg-surface-muted p-3"
            items={[
              {
                label: "Organisation type",
                value: (
                  <Badge tone="brand">
                    {preview.organisationType === "agency" ? "Agency" : "Facility"}
                  </Badge>
                ),
              },
              { label: "Expires", value: expiry.format(new Date(preview.expiresAt)) },
            ]}
          />
          <p className="text-sm text-muted-foreground">
            Accepting adds this role to your account. You can switch between your organisations at
            any time.
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
