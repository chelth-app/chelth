"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  ROUNDING_INCREMENTS,
  SHIFT_CLASSIFICATION_LABELS,
  SHIFT_CLASSIFICATIONS,
  SUPPORTED_CURRENCIES,
} from "@/lib/domain/pricing";

import {
  createOvertimePolicyAction,
  createRateAction,
  createRoundingPolicyAction,
  createVersionAction,
} from "../actions";

type State = Parameters<typeof fieldErrorsFor>[0];

function TermsFields({
  state,
  idPrefix,
  today,
}: {
  state: State;
  idPrefix: string;
  today: string;
}) {
  const id = (field: string) => `${idPrefix}-${field}`;
  return (
    <>
      <FormField
        id={id("currency")}
        label="Currency"
        required
        errors={fieldErrorsFor(state, "currency")}
      >
        <Select name="currency" defaultValue="USD">
          {SUPPORTED_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        id={id("pay")}
        label="Pay rate per hour"
        description="What the worker is paid, e.g. 42.50."
        required
        errors={fieldErrorsFor(state, "payRate")}
      >
        <Input name="payRate" inputMode="decimal" autoComplete="off" />
      </FormField>
      <FormField
        id={id("bill")}
        label="Bill rate per hour"
        description="What the facility is charged, e.g. 58.00."
        required
        errors={fieldErrorsFor(state, "billRate")}
      >
        <Input name="billRate" inputMode="decimal" autoComplete="off" />
      </FormField>
      <FormField
        id={id("from")}
        label="Effective from"
        required
        errors={fieldErrorsFor(state, "effectiveFrom")}
      >
        <Input name="effectiveFrom" type="date" defaultValue={today} />
      </FormField>
      <FormField
        id={id("to")}
        label="Effective to (optional)"
        description="Last day this rate applies. Leave empty for no end."
        errors={fieldErrorsFor(state, "effectiveTo")}
      >
        <Input name="effectiveTo" type="date" />
      </FormField>
    </>
  );
}

/** New rate = a scope + a DRAFT version. Nothing applies until it is activated. */
export function NewRateForm({
  organisationId,
  disciplines,
  relationships,
  today,
}: {
  organisationId: string;
  disciplines: { key: string; name: string }[];
  relationships: { id: string; facilityName: string }[];
  today: string;
}) {
  const [state, formAction] = useActionState(createRateAction, null);
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-3" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <FormField
        id="rate-facility"
        label="Facility"
        errors={fieldErrorsFor(state, "relationshipId")}
      >
        <Select name="relationshipId" defaultValue="">
          <option value="">All facilities</option>
          {relationships.map((relationship) => (
            <option key={relationship.id} value={relationship.id}>
              {relationship.facilityName}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        id="rate-discipline"
        label="Discipline"
        required
        errors={fieldErrorsFor(state, "disciplineKey")}
      >
        <Select name="disciplineKey" defaultValue="">
          <option value="" disabled>
            Choose a discipline
          </option>
          {disciplines.map((discipline) => (
            <option key={discipline.key} value={discipline.key}>
              {discipline.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        id="rate-classification"
        label="Shift type"
        errors={fieldErrorsFor(state, "classification")}
      >
        <Select name="classification" defaultValue="">
          <option value="">Any shift type</option>
          {SHIFT_CLASSIFICATIONS.map((value) => (
            <option key={value} value={value}>
              {SHIFT_CLASSIFICATION_LABELS[value]}
            </option>
          ))}
        </Select>
      </FormField>
      <TermsFields state={state} idPrefix="rate" today={today} />
      <SubmitButton className="w-fit">Save draft rate</SubmitButton>
      <FormAlert
        state={state}
        successMessage="Draft saved. Activate it to use it for pricing."
        className="sm:col-span-3"
      />
    </form>
  );
}

export function NewVersionForm({
  organisationId,
  rateCardId,
  label,
  today,
  stacked = false,
}: {
  organisationId: string;
  rateCardId: string;
  label: string;
  today: string;
  /** One column (narrow surfaces such as the Rate Details drawer). */
  stacked?: boolean;
}) {
  const [state, formAction] = useActionState(createVersionAction, null);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-primary">New version for {label}</summary>
      <form
        action={formAction}
        className={stacked ? "mt-3 grid gap-3" : "mt-3 grid gap-3 sm:grid-cols-3"}
        noValidate
      >
        <input type="hidden" name="organisationId" value={organisationId} />
        <input type="hidden" name="rateCardId" value={rateCardId} />
        <TermsFields state={state} idPrefix={`version-${rateCardId}`} today={today} />
        <SubmitButton variant="outline" className="w-fit">
          Save draft version
        </SubmitButton>
        <FormAlert state={state} successMessage="Draft version saved." className="sm:col-span-3" />
      </form>
    </details>
  );
}

export function RoundingPolicyForm({
  organisationId,
  today,
}: {
  organisationId: string;
  today: string;
}) {
  const [state, formAction] = useActionState(createRoundingPolicyAction, null);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <FormField id="rounding-mode" label="Rounding">
        <Select name="mode" defaultValue="none">
          <option value="none">Exact minutes (no rounding)</option>
          <option value="nearest">To the nearest…</option>
        </Select>
      </FormField>
      <FormField
        id="rounding-increment"
        label="Minutes"
        errors={fieldErrorsFor(state, "increment")}
      >
        <Select name="increment" defaultValue="">
          <option value="">—</option>
          {ROUNDING_INCREMENTS.map((value) => (
            <option key={value} value={value}>
              {value} minutes
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        id="rounding-from"
        label="Effective from"
        errors={fieldErrorsFor(state, "effectiveFrom")}
      >
        <Input name="effectiveFrom" type="date" defaultValue={today} />
      </FormField>
      <SubmitButton variant="outline" className="w-fit">
        Save draft rounding policy
      </SubmitButton>
      <FormAlert state={state} successMessage="Draft saved." />
    </form>
  );
}

export function OvertimePolicyForm({
  organisationId,
  today,
}: {
  organisationId: string;
  today: string;
}) {
  const [state, formAction] = useActionState(createOvertimePolicyAction, null);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <FormField id="overtime-side" label="Applies to">
        <Select name="side" defaultValue="pay">
          <option value="pay">Pay</option>
          <option value="bill">Bill</option>
        </Select>
      </FormField>
      <FormField id="overtime-mode" label="Overtime">
        <Select name="mode" defaultValue="weekly_threshold">
          <option value="weekly_threshold">Weekly threshold</option>
          <option value="none">No overtime</option>
        </Select>
      </FormField>
      <FormField
        id="overtime-hours"
        label="Hours per week"
        errors={fieldErrorsFor(state, "thresholdHours")}
      >
        <Input name="thresholdHours" inputMode="decimal" placeholder="40" />
      </FormField>
      <FormField
        id="overtime-multiplier"
        label="Multiplier"
        errors={fieldErrorsFor(state, "multiplier")}
      >
        <Input name="multiplier" inputMode="decimal" placeholder="1.5" />
      </FormField>
      <FormField
        id="overtime-from"
        label="Effective from"
        errors={fieldErrorsFor(state, "effectiveFrom")}
      >
        <Input name="effectiveFrom" type="date" defaultValue={today} />
      </FormField>
      <SubmitButton variant="outline" className="w-fit">
        Save draft overtime policy
      </SubmitButton>
      <FormAlert state={state} successMessage="Draft saved." />
    </form>
  );
}
