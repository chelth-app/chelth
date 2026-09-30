"use client";

import { useActionState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";

import { resendInviteAction } from "../actions";
import { IssuedInviteLink } from "./issued-invite-link";

export function ResendInviteForm({
  organisationId,
  inviteId,
  email,
}: {
  organisationId: string;
  inviteId: string;
  email: string;
}) {
  const [state, formAction] = useActionState(resendInviteAction, null);
  return (
    <div className="flex flex-col gap-2">
      <form action={formAction}>
        <input type="hidden" name="organisationId" value={organisationId} />
        <input type="hidden" name="inviteId" value={inviteId} />
        <SubmitButton variant="outline" size="sm" aria-label={`Resend invitation to ${email}`}>
          Resend
        </SubmitButton>
      </form>
      {state?.ok ? (
        <IssuedInviteLink invite={{ ...state.data, email }} />
      ) : (
        <FormAlert state={state} className="p-2 text-xs" />
      )}
    </div>
  );
}
