"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";

import { addWorkerNoteAction } from "../actions";

export function AddWorkerNoteForm(props: { organisationId: string; workerId: string }) {
  const [state, formAction] = useActionState(addWorkerNoteAction, null);
  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3" noValidate>
      <FormAlert state={state} successMessage="Note added." />
      <input type="hidden" name="organisationId" value={props.organisationId} />
      <input type="hidden" name="workerId" value={props.workerId} />
      <FormField
        id="worker-note"
        label="Add internal note"
        description="Visible to agency staff with note access, never to the worker. Do not record clinical or credential details."
        required
        errors={fieldErrorsFor(state, "body")}
      >
        <Textarea name="body" rows={3} maxLength={2000} />
      </FormField>
      <SubmitButton className="w-fit" variant="outline">
        Add note
      </SubmitButton>
    </form>
  );
}
