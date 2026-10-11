"use client";

import { useActionState, useState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { type Terminology, terminology } from "@/lib/i18n/terminology";

import { createCredentialAction } from "../actions";
import type { CredentialTypeOption, JurisdictionOption } from "../queries";

type CreateCredentialFormProps = {
  organisationId: string;
  organisationName: string;
  credentialTypes: CredentialTypeOption[];
  jurisdictions: JurisdictionOption[];
  /** Locale spelling (License / Licence); defaults to the fallback locale. */
  terms?: Terminology;
};

export function CreateCredentialForm({
  organisationId,
  organisationName,
  credentialTypes,
  jurisdictions,
  terms = terminology(),
}: CreateCredentialFormProps) {
  const [state, formAction] = useActionState(createCredentialAction, null);
  const [typeKey, setTypeKey] = useState("");
  const type = credentialTypes.find((candidate) => candidate.key === typeKey);
  const jurisdictionOptions = type
    ? jurisdictions.filter((jurisdiction) => jurisdiction.level === type.jurisdictionRule)
    : [];
  const errors = (field: string) => fieldErrorsFor(state, field);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormAlert state={state} />
      <input type="hidden" name="organisationId" value={organisationId} />
      {/* One column at every width: the worker app is a phone-width column. */}
      <div className="grid gap-4 [&_input]:h-12 [&_input]:rounded-[10px] [&_select]:h-12 [&_select]:rounded-[10px]">
        <FormField
          id="credential-type"
          label="Credential type"
          required
          errors={errors("credentialTypeKey")}
        >
          <Select
            name="credentialTypeKey"
            value={typeKey}
            onChange={(event) => setTypeKey(event.target.value)}
          >
            <option value="" disabled>
              Choose a credential
            </option>
            {credentialTypes.map((option) => (
              <option key={option.key} value={option.key}>
                {option.name}
              </option>
            ))}
          </Select>
        </FormField>
        {type && type.jurisdictionRule !== "none" ? (
          <FormField
            id="credential-jurisdiction"
            label={
              type.jurisdictionRule === "subdivision" ? "Issuing state / region" : "Issuing country"
            }
            required
            errors={errors("jurisdictionCode")}
          >
            <Select name="jurisdictionCode" defaultValue="">
              <option value="" disabled>
                Choose
              </option>
              {jurisdictionOptions.map((jurisdiction) => (
                <option key={jurisdiction.code} value={jurisdiction.code}>
                  {jurisdiction.name}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}
        <FormField
          id="credential-authority"
          label="Issuing body"
          errors={errors("issuingAuthority")}
        >
          <Input name="issuingAuthority" autoComplete="off" />
        </FormField>
        {type?.requiresCredentialNumber ? (
          <FormField
            id="credential-number"
            label={terms.licenseNumber}
            description="Visible only to you and agency credential reviewers."
            required
            errors={errors("credentialNumber")}
          >
            <Input name="credentialNumber" autoComplete="off" />
          </FormField>
        ) : null}
        <FormField
          id="credential-issued"
          label="Issue date"
          required={type?.requiresIssueDate ?? false}
          errors={errors("issueDate")}
        >
          <Input name="issueDate" type="date" className="min-w-0" />
        </FormField>
        <FormField
          id="credential-expires"
          label="Expiry date"
          required={type?.requiresExpiryDate ?? false}
          errors={errors("expiryDate")}
        >
          <Input name="expiryDate" type="date" className="min-w-0" />
        </FormField>
      </div>
      <div className="flex items-start gap-3 rounded-[12px] border border-[rgba(18,107,103,0.14)] bg-[#f6fbfa] px-3.5 py-3 text-[14px] leading-5 text-slate-700">
        <input
          id="credential-share"
          type="checkbox"
          name="shareWithAgency"
          defaultChecked
          aria-describedby="credential-share-note"
          className="mt-0.5 size-5 shrink-0 accent-[#00666c]"
        />
        <div className="flex flex-col gap-0.5">
          <label
            htmlFor="credential-share"
            className="cursor-pointer font-semibold text-chelth-navy"
          >
            Share with {organisationName}
          </label>
          <p id="credential-share-note">
            So they can review it. You can stop sharing at any time. Other agencies see it only if
            you share it with them too.
          </p>
        </div>
      </div>
      <SubmitButton className="h-12 w-full rounded-[8px] text-[15px]">
        Save and continue
      </SubmitButton>
    </form>
  );
}
