"use client";

import { useActionState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { Select } from "@/components/ui/select";
import {
  SHIFT_CLASSIFICATION_LABELS,
  SHIFT_CLASSIFICATIONS,
  type ShiftClassification,
} from "@/lib/domain/pricing";

import { priceTimesheetAction, setShiftClassificationAction } from "../actions";

/** Prices one locked revision. Carries the revision the user saw; nothing else. */
export function PriceTimesheetForm({
  organisationId,
  timesheetId,
  revision,
  workerName,
  label = "Price",
}: {
  organisationId: string;
  timesheetId: string;
  revision: number;
  workerName: string;
  label?: string;
}) {
  const [state, formAction] = useActionState(priceTimesheetAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="timesheetId" value={timesheetId} />
      <input type="hidden" name="revision" value={revision} />
      <SubmitButton size="sm" className="w-fit" aria-label={`${label} timesheet for ${workerName}`}>
        {label}
      </SubmitButton>
      {state && !state.ok ? <FormAlert state={state} className="p-2 text-xs" /> : null}
    </form>
  );
}

export function ShiftClassificationForm({
  organisationId,
  shiftId,
  classification,
}: {
  organisationId: string;
  shiftId: string;
  classification: ShiftClassification;
}) {
  const [state, formAction] = useActionState(setShiftClassificationAction, null);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="shiftId" value={shiftId} />
      <label htmlFor={`classification-${shiftId}`} className="text-sm font-medium">
        Shift type
      </label>
      <Select
        id={`classification-${shiftId}`}
        name="classification"
        defaultValue={classification}
        className="w-40"
      >
        {SHIFT_CLASSIFICATIONS.map((value) => (
          <option key={value} value={value}>
            {SHIFT_CLASSIFICATION_LABELS[value]}
          </option>
        ))}
      </Select>
      <SubmitButton size="sm" variant="outline" className="w-fit">
        Save shift type
      </SubmitButton>
      <FormAlert state={state} successMessage="Saved." className="p-2 text-xs" />
    </form>
  );
}
