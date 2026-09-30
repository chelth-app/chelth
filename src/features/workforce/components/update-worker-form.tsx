"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

import { updateWorkerAction } from "../actions";

export function UpdateWorkerForm(props: {
  organisationId: string;
  workerId: string;
  workerReference: string;
}) {
  const [state, formAction] = useActionState(updateWorkerAction, null);
  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3" noValidate>
      <FormAlert state={state} successMessage="Worker record updated." />
      <input type="hidden" name="organisationId" value={props.organisationId} />
      <input type="hidden" name="workerId" value={props.workerId} />
      <FormField
        id="worker-reference"
        label="Agency worker reference"
        description="Your agency's own reference, e.g. a payroll or HR number."
        errors={fieldErrorsFor(state, "workerReference")}
      >
        <Input name="workerReference" defaultValue={props.workerReference} autoComplete="off" />
      </FormField>
      <SubmitButton className="w-fit" variant="outline">
        Save reference
      </SubmitButton>
    </form>
  );
}
