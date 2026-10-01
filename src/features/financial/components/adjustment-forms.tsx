"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

import { cancelPayrollAdjustmentAction, voidInvoiceAdjustmentAction } from "../adjustment-actions";
import { setMakerCheckerAction } from "../actions";

/** Before lock only: releases the revision transition for a fresh adjustment. */
export function CancelPayrollAdjustmentForm({
  organisationId,
  adjustmentId,
}: {
  organisationId: string;
  adjustmentId: string;
}) {
  const [state, formAction] = useActionState(cancelPayrollAdjustmentAction, null);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-primary">Cancel adjustment</summary>
      <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2" noValidate>
        <input type="hidden" name="organisationId" value={organisationId} />
        <input type="hidden" name="adjustmentId" value={adjustmentId} />
        <FormField
          id={`cancel-adjustment-${adjustmentId}`}
          label="Reason for cancelling"
          required
          errors={fieldErrorsFor(state, "reason")}
        >
          <Input name="reason" maxLength={500} />
        </FormField>
        <SubmitButton size="sm" variant="danger">
          Cancel adjustment
        </SubmitButton>
        {state && !state.ok ? <FormAlert state={state} className="p-2 text-xs" /> : null}
      </form>
    </details>
  );
}

/** Before lock only: the draft stays as it is; its transition is released. */
export function VoidInvoiceAdjustmentForm({
  organisationId,
  adjustmentId,
}: {
  organisationId: string;
  adjustmentId: string;
}) {
  const [state, formAction] = useActionState(voidInvoiceAdjustmentAction, null);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-primary">Void adjustment</summary>
      <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2" noValidate>
        <input type="hidden" name="organisationId" value={organisationId} />
        <input type="hidden" name="adjustmentId" value={adjustmentId} />
        <FormField
          id={`void-adjustment-${adjustmentId}`}
          label="Reason for voiding"
          required
          errors={fieldErrorsFor(state, "reason")}
        >
          <Input name="reason" maxLength={500} />
        </FormField>
        <SubmitButton size="sm" variant="danger">
          Void adjustment
        </SubmitButton>
        {state && !state.ok ? <FormAlert state={state} className="p-2 text-xs" /> : null}
      </form>
    </details>
  );
}

/** Optional control: the person who prepared a financial document may not approve it. */
export function MakerCheckerForm({
  organisationId,
  required,
}: {
  organisationId: string;
  required: boolean;
}) {
  const [state, formAction] = useActionState(setMakerCheckerAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="required" value={required ? "false" : "true"} />
      <p className="text-sm">
        Second approver:{" "}
        <span className="font-medium">{required ? "required" : "not required"}</span>.{" "}
        {required
          ? "Whoever prepares a batch, draft or adjustment cannot approve it."
          : "The person who prepares a document may also approve it."}
      </p>
      <SubmitButton size="sm" variant="outline" className="w-fit">
        {required ? "Stop requiring a second approver" : "Require a second approver"}
      </SubmitButton>
      <FormAlert state={state} successMessage="Saved." className="p-2 text-xs" />
    </form>
  );
}
