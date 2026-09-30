"use client";

import { useActionState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";

import { acceptInviteAction } from "../actions";

export function AcceptInviteForm() {
  const [state, formAction] = useActionState(acceptInviteAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <FormAlert state={state} />
      <SubmitButton className="w-fit">Accept invitation</SubmitButton>
    </form>
  );
}
