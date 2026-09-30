"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { IssuedInviteLink } from "@/components/shared/issued-invite-link";

import { inviteWorkerAction } from "../actions";

export function InviteWorkerForm({ organisationId }: { organisationId: string }) {
  const [state, formAction] = useActionState(inviteWorkerAction, null);
  return (
    <div className="flex flex-col gap-3">
      {state?.ok ? <IssuedInviteLink invite={state.data} /> : null}
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
        <input type="hidden" name="organisationId" value={organisationId} />
        <FormField
          id="worker-email"
          label="Worker email address"
          required
          className="sm:flex-1"
          errors={fieldErrorsFor(state, "email")}
        >
          <Input name="email" type="email" autoComplete="off" />
        </FormField>
        <SubmitButton className="w-fit">Invite worker</SubmitButton>
      </form>
      {state && !state.ok ? <FormAlert state={state} /> : null}
    </div>
  );
}
