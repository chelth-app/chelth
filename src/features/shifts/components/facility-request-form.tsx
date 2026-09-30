"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";

import { submitFacilityRequestAction } from "../actions";
import { ShiftScheduleFields } from "./shift-schedule-fields";

type FacilityRequestFormProps = {
  organisationId: string;
  options: {
    relationshipId: string;
    agencyName: string;
    locationId: string;
    locationName: string;
    timezone: string;
  }[];
  disciplines: { key: string; name: string }[];
  minDate: string;
};

/** A staffing request goes to ONE partner agency through its active relationship. */
export function FacilityRequestForm({
  organisationId,
  options,
  disciplines,
  minDate,
}: FacilityRequestFormProps) {
  const [state, formAction] = useActionState(submitFacilityRequestAction, null);
  return (
    <form action={formAction} className="grid max-w-3xl gap-3 sm:grid-cols-2" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <FormField
        id="request-location"
        label="Agency and location"
        required
        errors={fieldErrorsFor(state, "relationshipLocation")}
        className="sm:col-span-2"
      >
        <Select name="relationshipLocation" defaultValue="">
          <option value="" disabled>
            Choose an agency and location
          </option>
          {options.map((option) => (
            <option
              key={`${option.relationshipId}:${option.locationId}`}
              value={`${option.relationshipId}:${option.locationId}`}
            >
              {option.agencyName} — {option.locationName} ({option.timezone})
            </option>
          ))}
        </Select>
      </FormField>
      <ShiftScheduleFields
        idPrefix="request"
        state={state}
        disciplines={disciplines}
        minDate={minDate}
      />
      <SubmitButton className="w-fit">Submit request</SubmitButton>
      <FormAlert state={state} className="sm:col-span-2" />
    </form>
  );
}
