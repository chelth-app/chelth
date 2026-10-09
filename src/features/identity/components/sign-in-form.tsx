"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

import { signInAction } from "../actions";

export function SignInForm({ next }: { next?: string | undefined }) {
  const [state, formAction] = useActionState(signInAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormAlert state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <FormField id="email" label="Email address" required errors={fieldErrorsFor(state, "email")}>
        <Input name="email" type="email" autoComplete="email" />
      </FormField>
      <FormField id="password" label="Password" required errors={fieldErrorsFor(state, "password")}>
        <PasswordInput name="password" autoComplete="current-password" />
      </FormField>
      <SubmitButton>Sign in</SubmitButton>
    </form>
  );
}
