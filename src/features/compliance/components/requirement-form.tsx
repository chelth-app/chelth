"use client";

import { useActionState, useCallback, useState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { type Terminology, terminology } from "@/lib/i18n/terminology";

import { createRequirementAction } from "../actions";
import { CustomTypeForm } from "./custom-type-form";

type Option = { key: string; name: string };

/** Select value that opens the custom requirement form instead of choosing a type. */
const CREATE_CUSTOM = "__create_custom__";

type RequirementFormProps = {
  organisationId: string;
  facilityId?: string;
  credentialTypes: (Option & { scope: "person" | "facility"; custom?: boolean })[];
  disciplines: Option[];
  jurisdictions: { code: string; name: string }[];
  /**
   * Facility-scoped: the facility's local date. Agency-wide: omitted — Chelth has
   * no agency timezone, so the user chooses the date explicitly.
   */
  defaultEffectiveFrom?: string;
  /** Shown with the field, e.g. "Mercy Rehab local date (America/New_York)". */
  effectiveFromHint: string;
  /** Locale spelling (License / Licence); defaults to the fallback locale. */
  terms?: Terminology;
  /** P0-E9-3J: offer "+ Create custom requirement" (the agency can manage requirements). */
  canCreateCustom?: boolean;
};

export function RequirementForm({
  organisationId,
  facilityId,
  credentialTypes,
  disciplines,
  jurisdictions,
  defaultEffectiveFrom,
  effectiveFromHint,
  terms = terminology(),
  canCreateCustom = false,
}: RequirementFormProps) {
  const [state, formAction] = useActionState(createRequirementAction, null);
  const [typeKey, setTypeKey] = useState("");
  const [creating, setCreating] = useState(false);
  const onCreated = useCallback((key: string) => {
    // The action revalidated this page, so the new type is already in the list.
    setTypeKey(key);
    setCreating(false);
  }, []);
  // Facility-specific types (e.g. orientation) can only be required by a facility.
  const types = facilityId
    ? credentialTypes
    : credentialTypes.filter((type) => type.scope === "person");
  const standard = types.filter((type) => !type.custom);
  const custom = types.filter((type) => type.custom);
  const prefix = facilityId ? "facility-req" : "agency-req";
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <form action={formAction} className="grid gap-3 sm:grid-cols-3" noValidate>
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
          <Select
            name="credentialTypeKey"
            value={typeKey}
            onChange={(event) => {
              if (event.target.value === CREATE_CUSTOM) {
                setCreating(true);
                return;
              }
              setTypeKey(event.target.value);
            }}
          >
            <option value="" disabled>
              Choose a credential
            </option>
            <optgroup label="Chelth standard">
              {standard.map((type) => (
                <option key={type.key} value={type.key}>
                  {type.name}
                </option>
              ))}
            </optgroup>
            {custom.length > 0 ? (
              <optgroup label="Your custom requirements">
                {custom.map((type) => (
                  <option key={type.key} value={type.key}>
                    {type.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {canCreateCustom ? (
              <option value={CREATE_CUSTOM}>+ Create custom requirement</option>
            ) : null}
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
          label={`Jurisdiction (${terms.licensesLower})`}
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
      {creating ? (
        <section
          aria-labelledby={`${prefix}-custom-heading`}
          className="rounded-md border border-border bg-surface p-4"
        >
          <h3
            id={`${prefix}-custom-heading`}
            className="mb-1 text-sm font-semibold text-foreground"
          >
            Create custom requirement
          </h3>
          <p className="mb-3 text-[13px] leading-5 text-slate-600">
            Only your agency can see and use it. It&apos;s selected here once created.
          </p>
          <CustomTypeForm
            organisationId={organisationId}
            idPrefix={`${prefix}-custom`}
            onCreated={onCreated}
            onCancel={() => setCreating(false)}
          />
        </section>
      ) : null}
    </div>
  );
}
