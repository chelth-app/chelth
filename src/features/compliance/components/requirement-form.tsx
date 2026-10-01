"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import { createRequirementAction } from "../actions";

type Option = { key: string; name: string };

type RequirementFormProps = {
  organisationId: string;
  facilityId?: string;
  credentialTypes: (Option & { scope: "person" | "facility" })[];
  disciplines: Option[];
  jurisdictions: { code: string; name: string }[];
  /**
   * Facility-scoped: the facility's local date. Agency-wide: omitted — Chelth has
   * no agency timezone, so the user chooses the date explicitly.
   */
  defaultEffectiveFrom?: string;
  /** Shown with the field, e.g. "Mercy Rehab local date (America/New_York)". */
  effectiveFromHint: string;
};

export function RequirementForm({
  organisationId,
  facilityId,
  credentialTypes,
  disciplines,
  jurisdictions,
  defaultEffectiveFrom,
  effectiveFromHint,
}: RequirementFormProps) {
  const [state, formAction] = useActionState(createRequirementAction, null);
  // Facility-specific types (e.g. orientation) can only be required by a facility.
  const types = facilityId
    ? credentialTypes
    : credentialTypes.filter((type) => type.scope === "person");
  const prefix = facilityId ? "facility-req" : "agency-req";
  return (
    <form action={formAction} className="grid max-w-3xl gap-3 sm:grid-cols-3" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      {facilityId ? <input type="hidden" name="facilityId" value={facilityId} /> : null}
      <FormField
        id={`${prefix}-effective-from`}
        label="Effective from"
        description={effectiveFromHint}
        required
        errors={fieldErrorsFor(state, "effectiveFrom")}
      >
        <Input name="effectiveFrom" type="date" defaultValue={defaultEffectiveFrom ?? ""} />
      </FormField>
      <FormField
        id={`${prefix}-type`}
        label="Credential"
        required
        errors={fieldErrorsFor(state, "credentialTypeKey")}
      >
        <Select name="credentialTypeKey" defaultValue="">
          <option value="" disabled>
            Choose a credential
          </option>
          {types.map((type) => (
            <option key={type.key} value={type.key}>
              {type.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        id={`${prefix}-discipline`}
        label="Applies to"
        errors={fieldErrorsFor(state, "disciplineKey")}
      >
        <Select name="disciplineKey" defaultValue="">
          <option value="">All workers</option>
          {disciplines.map((discipline) => (
            <option key={discipline.key} value={discipline.key}>
              {discipline.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        id={`${prefix}-jurisdiction`}
        label="Jurisdiction (licences)"
        errors={fieldErrorsFor(state, "jurisdictionCode")}
      >
        <Select name="jurisdictionCode" defaultValue="">
          <option value="">Any</option>
          {jurisdictions.map((jurisdiction) => (
            <option key={jurisdiction.code} value={jurisdiction.code}>
              {jurisdiction.name} ({jurisdiction.code})
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        id={`${prefix}-validity`}
        label="Minimum validity (days)"
        errors={fieldErrorsFor(state, "minimumValidityDays")}
      >
        <Input name="minimumValidityDays" type="number" min={0} max={730} defaultValue={0} />
      </FormField>
      <FormField
        id={`${prefix}-warning`}
        label="Warn before expiry (days)"
        errors={fieldErrorsFor(state, "expiryWarningDays")}
      >
        <Input name="expiryWarningDays" type="number" min={0} max={365} defaultValue={30} />
      </FormField>
      <label className="flex items-center gap-2 self-end pb-3 text-sm">
        <input type="checkbox" name="mustBeVerified" defaultChecked className="size-4" />
        Must be verified by the agency
      </label>
      <div className="flex flex-col gap-2 sm:col-span-3">
        <FormAlert state={state} successMessage="Requirement added." />
        <SubmitButton className="w-fit" variant="outline">
          Add requirement
        </SubmitButton>
      </div>
    </form>
  );
}
