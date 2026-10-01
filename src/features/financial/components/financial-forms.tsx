"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  PAYROLL_PERIOD_TYPE_LABELS,
  PAYROLL_PERIOD_TYPES,
  type PayrollPeriodType,
} from "@/lib/domain/financial";

import {
  cancelPayrollBatchAction,
  saveFinancialSettingsAction,
  voidInvoiceDraftAction,
} from "../actions";

/** Payroll period + reference prefixes. Dates only: no timezone is involved. */
export function FinancialSettingsForm({
  organisationId,
  periodType,
  anchorDate,
  payrollPrefix,
  invoicePrefix,
}: {
  organisationId: string;
  periodType: PayrollPeriodType;
  anchorDate: string;
  payrollPrefix: string;
  invoicePrefix: string;
}) {
  const [state, formAction] = useActionState(saveFinancialSettingsAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          id="payroll-period-type"
          label="Payroll period"
          required
          errors={fieldErrorsFor(state, "payrollPeriodType")}
        >
          <Select name="payrollPeriodType" defaultValue={periodType}>
            {PAYROLL_PERIOD_TYPES.map((value) => (
              <option key={value} value={value}>
                {PAYROLL_PERIOD_TYPE_LABELS[value]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          id="payroll-anchor-date"
          label="A period starts on"
          description="Any date that begins a payroll period. It sets the weekday and the two-week alignment."
          required
          errors={fieldErrorsFor(state, "payrollAnchorDate")}
        >
          <Input name="payrollAnchorDate" type="date" defaultValue={anchorDate} />
        </FormField>
        <FormField
          id="payroll-reference-prefix"
          label="Payroll batch prefix"
          required
          errors={fieldErrorsFor(state, "payrollReferencePrefix")}
        >
          <Input name="payrollReferencePrefix" defaultValue={payrollPrefix} maxLength={20} />
        </FormField>
        <FormField
          id="invoice-reference-prefix"
          label="Invoice draft prefix"
          required
          errors={fieldErrorsFor(state, "invoiceReferencePrefix")}
        >
          <Input name="invoiceReferencePrefix" defaultValue={invoicePrefix} maxLength={20} />
        </FormField>
      </div>
      <SubmitButton size="sm" variant="outline" className="w-fit">
        Save payroll settings
      </SubmitButton>
      <FormAlert state={state} successMessage="Saved." className="p-2 text-xs" />
    </form>
  );
}

/** Cancelling (before lock only) releases the batch's work for a new batch. */
export function CancelPayrollBatchForm({
  organisationId,
  batchId,
}: {
  organisationId: string;
  batchId: string;
}) {
  const [state, formAction] = useActionState(cancelPayrollBatchAction, null);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-primary">Cancel batch</summary>
      <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2" noValidate>
        <input type="hidden" name="organisationId" value={organisationId} />
        <input type="hidden" name="batchId" value={batchId} />
        <FormField
          id={`cancel-${batchId}`}
          label="Reason for cancelling"
          required
          errors={fieldErrorsFor(state, "reason")}
        >
          <Input name="reason" maxLength={500} />
        </FormField>
        <SubmitButton size="sm" variant="danger">
          Cancel batch
        </SubmitButton>
        {state && !state.ok ? <FormAlert state={state} className="p-2 text-xs" /> : null}
      </form>
    </details>
  );
}

/** Voiding never changes the draft; it releases its work for a new draft. */
export function VoidInvoiceDraftForm({
  organisationId,
  draftId,
}: {
  organisationId: string;
  draftId: string;
}) {
  const [state, formAction] = useActionState(voidInvoiceDraftAction, null);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-primary">Void draft</summary>
      <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2" noValidate>
        <input type="hidden" name="organisationId" value={organisationId} />
        <input type="hidden" name="draftId" value={draftId} />
        <FormField
          id={`void-${draftId}`}
          label="Reason for voiding"
          required
          errors={fieldErrorsFor(state, "reason")}
        >
          <Input name="reason" maxLength={500} />
        </FormField>
        <SubmitButton size="sm" variant="danger">
          Void draft
        </SubmitButton>
        {state && !state.ok ? <FormAlert state={state} className="p-2 text-xs" /> : null}
      </form>
    </details>
  );
}
