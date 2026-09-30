"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";

import { createShiftAction } from "../actions";
import { ShiftScheduleFields } from "./shift-schedule-fields";

type CreateShiftFormProps = {
  organisationId: string;
  locations: {
    facilityId: string;
    facilityName: string;
    locationId: string;
    locationName: string;
    timezone: string;
  }[];
  disciplines: { key: string; name: string }[];
  canOpen: boolean;
  minDate: string;
};

export function CreateShiftForm({
  organisationId,
  locations,
  disciplines,
  canOpen,
  minDate,
}: CreateShiftFormProps) {
  const [state, formAction] = useActionState(createShiftAction, null);
  return (
    <form action={formAction} className="grid max-w-3xl gap-3 sm:grid-cols-2" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <FormField
        id="shift-location"
        label="Facility and location"
        description="Only facilities with an active relationship can be scheduled."
        required
        errors={fieldErrorsFor(state, "facilityLocation")}
        className="sm:col-span-2"
      >
        <Select name="facilityLocation" defaultValue="">
          <option value="" disabled>
            Choose a location
          </option>
          {locations.map((location) => (
            <option
              key={location.locationId}
              value={`${location.facilityId}:${location.locationId}`}
            >
              {location.facilityName} — {location.locationName} ({location.timezone})
            </option>
          ))}
        </Select>
      </FormField>
      <ShiftScheduleFields
        idPrefix="shift"
        state={state}
        disciplines={disciplines}
        minDate={minDate}
      />
      {canOpen ? (
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="open" defaultChecked className="mt-1 size-4" />
          <span>
            Open the shift now so workers can be assigned (otherwise it is saved as a draft).
          </span>
        </label>
      ) : null}
      <SubmitButton className="w-fit">Create shift</SubmitButton>
      <FormAlert state={state} className="sm:col-span-2" />
    </form>
  );
}
