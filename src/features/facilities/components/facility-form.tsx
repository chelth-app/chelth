"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import { createFacilityAction, updateFacilityAction } from "../actions";

export type FacilityFormValues = {
  name: string;
  facilityTypeKey: string;
  timezone: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  locality: string;
  region: string;
  postalCode: string;
  countryCode: string;
  externalReference: string;
};

type FacilityFormProps = {
  organisationId: string;
  /** Present when editing an existing facility. */
  facilityId?: string;
  values?: FacilityFormValues;
  facilityTypes: { key: string; name: string }[];
  timezones: string[];
};

/** Create/update form for a client facility. Business contact details only. */
export function FacilityForm({
  organisationId,
  facilityId,
  values,
  facilityTypes,
  timezones,
}: FacilityFormProps) {
  const [state, formAction] = useActionState(
    facilityId ? updateFacilityAction : createFacilityAction,
    null,
  );
  const errors = (field: string) => fieldErrorsFor(state, field);

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4" noValidate>
      <FormAlert state={state} successMessage={facilityId ? "Facility updated." : undefined} />
      <input type="hidden" name="organisationId" value={organisationId} />
      {facilityId ? <input type="hidden" name="facilityId" value={facilityId} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="facility-name" label="Facility name" required errors={errors("name")}>
          <Input name="name" defaultValue={values?.name} autoComplete="organization" />
        </FormField>
        <FormField
          id="facility-type"
          label="Facility type"
          required
          errors={errors("facilityType")}
        >
          <Select name="facilityType" defaultValue={values?.facilityTypeKey ?? ""}>
            <option value="" disabled>
              Choose a type
            </option>
            {facilityTypes.map((type) => (
              <option key={type.key} value={type.key}>
                {type.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          id="facility-timezone"
          label="Timezone"
          description="Used for all times at this facility."
          required
          errors={errors("timezone")}
        >
          <Select name="timezone" defaultValue={values?.timezone ?? ""}>
            <option value="" disabled>
              Choose a timezone
            </option>
            {timezones.map((timezone) => (
              <option key={timezone} value={timezone}>
                {timezone}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          id="facility-reference"
          label="Your reference"
          errors={errors("externalReference")}
        >
          <Input
            name="externalReference"
            defaultValue={values?.externalReference}
            autoComplete="off"
          />
        </FormField>
        <FormField id="facility-phone" label="Site phone" errors={errors("phone")}>
          <Input name="phone" type="tel" defaultValue={values?.phone} autoComplete="off" />
        </FormField>
        <FormField
          id="facility-email"
          label="Site email"
          description="A shared site or department address, not a personal one."
          errors={errors("email")}
        >
          <Input name="email" type="email" defaultValue={values?.email} autoComplete="off" />
        </FormField>
        <FormField id="facility-address1" label="Address line 1" errors={errors("addressLine1")}>
          <Input
            name="addressLine1"
            defaultValue={values?.addressLine1}
            autoComplete="address-line1"
          />
        </FormField>
        <FormField id="facility-address2" label="Address line 2" errors={errors("addressLine2")}>
          <Input
            name="addressLine2"
            defaultValue={values?.addressLine2}
            autoComplete="address-line2"
          />
        </FormField>
        <FormField id="facility-locality" label="Town or city" errors={errors("locality")}>
          <Input name="locality" defaultValue={values?.locality} autoComplete="address-level2" />
        </FormField>
        <FormField id="facility-region" label="County, state or region" errors={errors("region")}>
          <Input name="region" defaultValue={values?.region} autoComplete="address-level1" />
        </FormField>
        <FormField id="facility-postcode" label="Postcode / ZIP" errors={errors("postalCode")}>
          <Input name="postalCode" defaultValue={values?.postalCode} autoComplete="postal-code" />
        </FormField>
        <FormField
          id="facility-country"
          label="Country code"
          description="Two letters, e.g. GB or US."
          errors={errors("countryCode")}
        >
          <Input
            name="countryCode"
            defaultValue={values?.countryCode}
            maxLength={2}
            autoComplete="country"
          />
        </FormField>
      </div>
      <SubmitButton className="w-fit">
        {facilityId ? "Save changes" : "Create facility"}
      </SubmitButton>
    </form>
  );
}
