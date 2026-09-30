"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

import { createVersionAction } from "../actions";

export function NewVersionForm(props: { organisationId: string; credentialId: string }) {
  const [state, formAction] = useActionState(createVersionAction, null);
  return (
    <form
      action={formAction}
      className="grid max-w-xl gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      noValidate
    >
      <input type="hidden" name="organisationId" value={props.organisationId} />
      <input type="hidden" name="credentialId" value={props.credentialId} />
      <FormField
        id="renew-issued"
        label="New issue date"
        errors={fieldErrorsFor(state, "issueDate")}
      >
        <Input name="issueDate" type="date" />
      </FormField>
      <FormField
        id="renew-expires"
        label="New expiry date"
        errors={fieldErrorsFor(state, "expiryDate")}
      >
        <Input name="expiryDate" type="date" />
      </FormField>
      <SubmitButton variant="outline" className="w-fit">
        Start renewal
      </SubmitButton>
      <FormAlert state={state} className="sm:col-span-3" />
    </form>
  );
}
