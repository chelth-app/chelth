"use client";

import { useActionState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import type { ActionState } from "@/lib/actions/run-action";

import { revokeInviteAction } from "../actions";
import { useInviteNotice } from "./invite-notice";

/**
 * "Cancel invite" for a pending invitation: the existing revoke semantics
 * (token unusable immediately, record and audit kept, never deleted). The
 * confirmation goes to the panel-level notice when one is present, because
 * this row leaves the list as soon as the page re-renders.
 */
export function CancelInviteForm({
  organisationId,
  inviteId,
  email,
}: {
  organisationId: string;
  inviteId: string;
  email: string;
}) {
  const notify = useInviteNotice();
  const [state, formAction] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await revokeInviteAction(previous, formData);
    if (result?.ok)
      notify?.(`Invitation cancelled. ${email} can no longer use the invitation link.`);
    return result;
  }, null);
  if (state?.ok && !notify) {
    return (
      <p role="status" className="text-sm font-medium text-success-soft-foreground">
        Invitation cancelled.
      </p>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="inviteId" value={inviteId} />
      <SubmitButton variant="outline" size="sm" aria-label={`Cancel invite to ${email}`}>
        Cancel invite
      </SubmitButton>
      <FormAlert state={state} className="p-2 text-xs" />
    </form>
  );
}
