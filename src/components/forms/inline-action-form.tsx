"use client";

import { useActionState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import type { ButtonProps } from "@/components/ui/button";
import type { ActionResult } from "@/lib/errors";

type InlineActionFormProps = {
  action: (
    state: ActionResult<null> | null,
    formData: FormData,
  ) => Promise<ActionResult<null> | null>;
  fields: Record<string, string>;
  label: string;
  /** Accessible name when the visible label is ambiguous (e.g. "Suspend" in a table row). */
  accessibleLabel?: string;
  variant?: ButtonProps["variant"];
};

/** A single-button form posting fixed hidden fields to a Server Action. */
export function InlineActionForm({
  action,
  fields,
  label,
  accessibleLabel,
  variant = "outline",
}: InlineActionFormProps) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-1">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton variant={variant} size="sm" aria-label={accessibleLabel}>
        {label}
      </SubmitButton>
      {state && !state.ok ? <FormAlert state={state} className="p-2 text-xs" /> : null}
    </form>
  );
}
