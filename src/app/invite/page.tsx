import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { KeyValueList } from "@/components/ui/key-value-list";
import { stateActionClass, stateSecondaryActionClass } from "@/components/ui/system-state";
import { AuthCard } from "@/features/identity";
import {
  AcceptInviteForm,
  dismissInviteAction,
  isInviteTokenFormat,
  previewInvite,
  readPendingInviteToken,
} from "@/features/organisations";
import { getAuthIdentity } from "@/lib/auth/session";
import { ROLES } from "@/lib/authz";
import { ERROR_CODES } from "@/lib/errors/error-codes";

export const metadata: Metadata = { title: "Invitation" };

const expiry = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

/**
 * Invitation landing and review.
 *
 * Signed out: an onboarding-oriented page that is IDENTICAL for valid, invalid
 * and missing tokens. Nothing derived from the invitation row (organisation,
 * role, email, validity) is shown before authentication: there is no
 * anonymous invitation oracle (docs/security/THREAT_MODEL_IDENTITY.md #11).
 *
 * Signed in: the database resolves the invitation only for the caller's
 * VERIFIED email (preview_organisation_invite), so the details shown — and
 * the "Invited email", which is the caller's own email — belong to this user.
 */
export default async function InvitePage() {
  const [identity, token] = await Promise.all([getAuthIdentity(), readPendingInviteToken()]);

  if (!identity) {
    return (
      <AuthCard
        title="You've been invited to join Chelth"
        icon="mail"
        description="Create or sign in to your account to review and accept your workforce invitation."
      >
        <ol className="flex list-decimal flex-col gap-1.5 rounded-[10px] bg-[#f6fbfa] py-3 pr-3 pl-8 text-sm text-slate-700">
          <li>Create your account with the email address the invitation was sent to.</li>
          <li>Confirm your email. You return here automatically.</li>
          <li>Review the invitation and accept it.</li>
        </ol>
        <Link href="/sign-up" className={`${stateActionClass} w-full`}>
          Create account
        </Link>
        <p className="text-center text-sm text-slate-600">
          Already have a Chelth account?{" "}
          <Link
            href="/sign-in?next=/invite"
            className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </AuthCard>
    );
  }

  const preview = isInviteTokenFormat(token) ? await previewInvite(token) : null;

  if (!preview) {
    return (
      <AuthCard title="Invitation" icon="mail">
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
      </AuthCard>
    );
  }

  const isWorkerInvite = preview.roleKey === ROLES.AGENCY_HEALTHCARE_WORKER;
  const isAgency = preview.organisationType === "agency";

  return (
    <AuthCard
      title={isWorkerInvite ? "Join as a healthcare worker" : "Review your invitation"}
      icon="mail"
      description={
        isWorkerInvite
          ? `${preview.organisationName} has invited you to join their workforce.`
          : `${preview.organisationName} has invited you to join them on Chelth.`
      }
    >
      <KeyValueList
        aria-label="Invitation details"
        className="rounded-[10px] border border-[rgba(18,107,103,0.08)] bg-[#f6fbfa] p-3"
        items={[
          { label: isAgency ? "Agency" : "Facility", value: preview.organisationName },
          { label: "Role", value: preview.roleName },
          { label: "Invited email", value: <span className="break-all">{identity.email}</span> },
          { label: "Expires", value: expiry.format(new Date(preview.expiresAt)) },
        ]}
      />
      <p className="text-sm text-slate-600">
        {isWorkerInvite
          ? "Accepting adds this agency to your account. You can work with more than one agency and switch between them at any time."
          : "Accepting adds this role to your account. You can switch between your organisations at any time."}
      </p>
      <AcceptInviteForm />
      <form action={dismissInviteAction}>
        <button type="submit" className={`${stateSecondaryActionClass} w-full`}>
          Not now
        </button>
      </form>
    </AuthCard>
  );
}
