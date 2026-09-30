"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/common";

import { signUpAction } from "../actions";

export function SignUpForm() {
  const [state, formAction] = useActionState(signUpAction, null);

  if (state?.ok) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Check your email</h2>
        <p className="text-sm text-muted-foreground">
          If this address can be registered, we have sent a confirmation link to{" "}
          <strong className="text-foreground">{state.data.email}</strong>. Follow it to activate
          your account.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormAlert state={state} />
      <FormField
        id="displayName"
        label="Full name"
        required
        errors={fieldErrorsFor(state, "displayName")}
      >
        <Input name="displayName" autoComplete="name" />
      </FormField>
      <FormField id="email" label="Email address" required errors={fieldErrorsFor(state, "email")}>
        <Input name="email" type="email" autoComplete="email" />
      </FormField>
      <FormField
        id="password"
        label="Password"
        description={`At least ${PASSWORD_MIN_LENGTH} characters, with upper and lower case letters and a number.`}
        required
        errors={fieldErrorsFor(state, "password")}
      >
        <Input name="password" type="password" autoComplete="new-password" />
      </FormField>
      <SubmitButton>Create account</SubmitButton>
    </form>
  );
}
