"use client";

import { useActionState, useState } from "react";

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

/**
 * A staffing request goes to ONE partner agency through its active
 * relationship (P0-E9-4A.1: no broadcast). One agency ⇒ no agency choice;
 * several ⇒ "Staffing agency" is required and filters the locations. The
 * relationship travels as one value that the database re-authorises.
 */
export function FacilityRequestForm({
  organisationId,
  options,
  disciplines,
  minDate,
}: FacilityRequestFormProps) {
  const [state, formAction] = useActionState(submitFacilityRequestAction, null);
  const agencies = [
    ...new Map(options.map((option) => [option.relationshipId, option.agencyName])).entries(),
  ].map(([relationshipId, agencyName]) => ({ relationshipId, agencyName }));
  const single = agencies.length === 1 ? agencies[0] : undefined;
  const [agency, setAgency] = useState(single?.relationshipId ?? "");
  const [location, setLocation] = useState("");
  const locations = options.filter((option) => option.relationshipId === agency);
  const value = agency && location ? `${agency}:${location}` : "";
  return (
    <form action={formAction} className="grid max-w-3xl gap-3 sm:grid-cols-2" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="relationshipLocation" value={value} />
      {single ? (
        <p className="text-sm text-slate-700 sm:col-span-2">
          Requests go to <span className="font-semibold text-chelth-navy">{single.agencyName}</span>
          .
        </p>
      ) : (
        <FormField
          id="request-agency"
          label="Staffing agency"
          required
          errors={agency ? undefined : fieldErrorsFor(state, "relationshipLocation")}
        >
          <Select
            value={agency}
            onChange={(event) => {
              setAgency(event.target.value);
              setLocation("");
            }}
          >
            <option value="" disabled>
              Choose an agency
            </option>
            {agencies.map((option) => (
              <option key={option.relationshipId} value={option.relationshipId}>
                {option.agencyName}
              </option>
            ))}
          </Select>
        </FormField>
      )}
      <FormField
        id="request-location"
        label="Location"
        required
        errors={agency ? fieldErrorsFor(state, "relationshipLocation") : undefined}
        className={single ? "sm:col-span-2" : undefined}
      >
        <Select
          value={location}
          onChange={(event) => setLocation(event.target.value)}
          disabled={!agency}
        >
          <option value="" disabled>
            {agency ? "Choose a location" : "Choose an agency first"}
          </option>
          {locations.map((option) => (
            <option key={`${option.relationshipId}:${option.locationId}`} value={option.locationId}>
              {option.locationName} ({option.timezone})
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
