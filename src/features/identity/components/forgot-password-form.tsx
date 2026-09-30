"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

import { requestPasswordResetAction } from "../actions";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordResetAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormAlert
        state={state}
        successMessage="If an account exists for that address, we have sent a password reset link."
      />
      <FormField id="email" label="Email address" required errors={fieldErrorsFor(state, "email")}>
        <Input name="email" type="email" autoComplete="email" />
      </FormField>
      <SubmitButton>Send reset link</SubmitButton>
    </form>
  );
}
