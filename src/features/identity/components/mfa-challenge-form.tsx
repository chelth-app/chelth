"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

import { verifyMfaChallengeAction } from "../actions";

export function MfaChallengeForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(verifyMfaChallengeAction, null);
  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-4" noValidate>
      <FormAlert state={state} />
      <input type="hidden" name="next" value={next} />
      <FormField
        id="code"
        label="Authentication code"
        required
        errors={fieldErrorsFor(state, "code")}
      >
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
      </FormField>
      <SubmitButton className="w-fit">Verify</SubmitButton>
    </form>
  );
}
