import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { stateActionClass, stateSecondaryActionClass } from "@/components/ui/system-state";
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
        icon="mail"
        description="Sign in or create an account using the email address the invitation was sent to."
      >
        <ol className="flex list-decimal flex-col gap-1.5 rounded-[10px] bg-[#f6fbfa] py-3 pr-3 pl-8 text-sm text-slate-700">
          <li>Sign in, or create an account with the invited email address.</li>
          <li>Verify your email if you are new to CHELTH.</li>
          <li>Review the invitation and accept it.</li>
        </ol>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/sign-in?next=/invite" className={`${stateActionClass} flex-1`}>
            Sign in
          </Link>
          <Link href="/sign-up" className={`${stateSecondaryActionClass} flex-1`}>
            Create account
          </Link>
        </div>
      </AuthCard>
    );
  }

  const preview = isInviteTokenFormat(token) ? await previewInvite(token) : null;

  return (
    <AuthCard title="Invitation" icon="mail">
      {preview ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            You have been invited to join <strong>{preview.organisationName}</strong> as{" "}
            <strong>{preview.roleName}</strong>.
          </p>
          <KeyValueList
            className="rounded-[10px] border border-[rgba(18,107,103,0.08)] bg-[#f6fbfa] p-3"
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
          <p className="text-sm text-slate-600">
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
