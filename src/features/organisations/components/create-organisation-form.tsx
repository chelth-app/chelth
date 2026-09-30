"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

import { createOrganisationAction } from "../actions";

export function CreateOrganisationForm() {
  const [state, formAction] = useActionState(createOrganisationAction, null);
  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4" noValidate>
      <FormAlert state={state} />
      <FormField
        id="organisation-name"
        label="Agency name"
        description="You will become the administrator of this agency."
        required
        errors={fieldErrorsFor(state, "name")}
      >
        <Input name="name" autoComplete="organization" />
      </FormField>
      <SubmitButton className="w-fit">Create agency</SubmitButton>
    </form>
  );
}
