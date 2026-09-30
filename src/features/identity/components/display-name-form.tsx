"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

import { updateDisplayNameAction } from "../actions";

export function DisplayNameForm({ displayName }: { displayName: string }) {
  const [state, formAction] = useActionState(updateDisplayNameAction, null);
  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4" noValidate>
      <FormAlert state={state} successMessage="Your name has been updated." />
      <FormField
        id="displayName"
        label="Full name"
        required
        errors={fieldErrorsFor(state, "displayName")}
      >
        <Input name="displayName" autoComplete="name" defaultValue={displayName} />
      </FormField>
      <SubmitButton className="w-fit">Save</SubmitButton>
    </form>
  );
}
