"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { requestAdditionalBusinessAction, withdrawAdditionalBusinessAction } from "../actions";

/**
 * P0-E9-4A.2: ask Chelth for a separate business. It becomes a separate
 * organisation with its own subscription once Chelth sets it up; nothing is
 * created or billed from this form.
 */
export function AdditionalBusinessForm() {
  const [state, formAction] = useActionState(requestAdditionalBusinessAction, null);
  return (
    <form action={formAction} className="grid max-w-2xl gap-3 sm:grid-cols-2" noValidate>
      <FormField
        id="business-name"
        label="Business name"
        required
        errors={fieldErrorsFor(state, "businessName")}
      >
        <Input name="businessName" maxLength={200} autoComplete="organization" />
      </FormField>
      <FormField
        id="business-billing"
        label="Billing contact email"
        required
        errors={fieldErrorsFor(state, "billingEmail")}
      >
        <Input name="billingEmail" type="email" autoComplete="email" />
      </FormField>
      <FormField
        id="business-note"
        label="Note"
        description="Optional. For example, how this business is separate from your existing one."
        errors={fieldErrorsFor(state, "note")}
        className="sm:col-span-2"
      >
        <Textarea name="note" rows={3} maxLength={1000} />
      </FormField>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <FormAlert
          state={state}
          successMessage="Request sent. Chelth will set up the new business and its subscription with you."
        />
        <SubmitButton className="w-fit" variant="outline">
          Request additional business
        </SubmitButton>
      </div>
    </form>
  );
}

export function WithdrawBusinessRequestForm({
  requestId,
  businessName,
}: {
  requestId: string;
  businessName: string;
}) {
  const [state, formAction] = useActionState(withdrawAdditionalBusinessAction, null);
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="requestId" value={requestId} />
      <SubmitButton size="sm" variant="ghost" aria-label={`Withdraw request for ${businessName}`}>
        Withdraw
      </SubmitButton>
      <FormAlert state={state} className="p-2 text-xs" />
    </form>
  );
}
