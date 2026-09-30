"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import { createLocationAction } from "../actions";

type CreateLocationFormProps = {
  organisationId: string;
  facilityId: string;
  facilityTimezone: string;
  timezones: string[];
};

export function CreateLocationForm({
  organisationId,
  facilityId,
  facilityTimezone,
  timezones,
}: CreateLocationFormProps) {
  const [state, formAction] = useActionState(createLocationAction, null);
  return (
    <form
      action={formAction}
      className="grid max-w-2xl gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      noValidate
    >
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="facilityId" value={facilityId} />
      <FormField
        id="location-name"
        label="Location name"
        required
        errors={fieldErrorsFor(state, "name")}
      >
        <Input name="name" placeholder="e.g. North Campus, Ward 7" autoComplete="off" />
      </FormField>
      <FormField id="location-timezone" label="Timezone" errors={fieldErrorsFor(state, "timezone")}>
        <Select name="timezone" defaultValue="">
          <option value="">Same as facility ({facilityTimezone})</option>
          {timezones.map((timezone) => (
            <option key={timezone} value={timezone}>
              {timezone}
            </option>
          ))}
        </Select>
      </FormField>
      <SubmitButton variant="outline" className="w-fit">
        Add location
      </SubmitButton>
      <FormAlert state={state} successMessage="Location added." className="sm:col-span-3" />
    </form>
  );
}
