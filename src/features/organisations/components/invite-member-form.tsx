"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import { inviteMemberAction } from "../actions";
import { IssuedInviteLink } from "@/components/shared/issued-invite-link";

type InviteMemberFormProps = {
  organisationId: string;
  /** Roles within the caller's ceiling (UI hint; the database enforces it). */
  roles: { key: string; name: string }[];
};

export function InviteMemberForm({ organisationId, roles }: InviteMemberFormProps) {
  const [state, formAction] = useActionState(inviteMemberAction, null);
  return (
    <div className="flex flex-col gap-4">
      {state?.ok ? <IssuedInviteLink invite={state.data} /> : null}
      <form
        action={formAction}
        className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        noValidate
      >
        <input type="hidden" name="organisationId" value={organisationId} />
        <FormField
          id="invite-email"
          label="Email address"
          required
          errors={fieldErrorsFor(state, "email")}
        >
          <Input name="email" type="email" autoComplete="off" />
        </FormField>
        <FormField id="invite-role" label="Role" required errors={fieldErrorsFor(state, "roleKey")}>
          <Select name="roleKey" defaultValue="">
            <option value="" disabled>
              Choose a role
            </option>
            {roles.map((role) => (
              <option key={role.key} value={role.key}>
                {role.name}
              </option>
            ))}
          </Select>
        </FormField>
        <SubmitButton className="w-fit">Create invitation</SubmitButton>
      </form>
      {state && !state.ok ? <FormAlert state={state} /> : null}
    </div>
  );
}
