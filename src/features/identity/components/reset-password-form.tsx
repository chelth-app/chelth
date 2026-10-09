"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { PasswordInput } from "@/components/ui/password-input";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/common";

import { updatePasswordAction } from "../actions";

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(updatePasswordAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormAlert state={state} />
      <FormField
        id="password"
        label="New password"
        description={`At least ${PASSWORD_MIN_LENGTH} characters, with upper and lower case letters and a number.`}
        required
        errors={fieldErrorsFor(state, "password")}
      >
        <PasswordInput name="password" autoComplete="new-password" revealLabel="new password" />
      </FormField>
      <FormField
        id="confirmPassword"
        label="Confirm new password"
        required
        errors={fieldErrorsFor(state, "confirmPassword")}
      >
        <PasswordInput
          name="confirmPassword"
          autoComplete="new-password"
          revealLabel="confirm password"
        />
      </FormField>
      <SubmitButton>Update password</SubmitButton>
    </form>
  );
}
