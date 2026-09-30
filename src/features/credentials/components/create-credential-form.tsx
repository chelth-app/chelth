"use client";

import { useActionState, useState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import { createCredentialAction } from "../actions";
import type { CredentialTypeOption, JurisdictionOption } from "../queries";

type CreateCredentialFormProps = {
  organisationId: string;
  organisationName: string;
  credentialTypes: CredentialTypeOption[];
  jurisdictions: JurisdictionOption[];
};

export function CreateCredentialForm({
  organisationId,
  organisationName,
  credentialTypes,
  jurisdictions,
}: CreateCredentialFormProps) {
  const [state, formAction] = useActionState(createCredentialAction, null);
  const [typeKey, setTypeKey] = useState("");
  const type = credentialTypes.find((candidate) => candidate.key === typeKey);
  const jurisdictionOptions = type
    ? jurisdictions.filter((jurisdiction) => jurisdiction.level === type.jurisdictionRule)
    : [];
  const errors = (field: string) => fieldErrorsFor(state, field);

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4" noValidate>
      <FormAlert state={state} />
      <input type="hidden" name="organisationId" value={organisationId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="credential-type"
          label="Credential"
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
            label="Licence / certificate number"
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
          <Input name="issueDate" type="date" />
        </FormField>
        <FormField
          id="credential-expires"
          label="Expiry date"
          required={type?.requiresExpiryDate ?? false}
          errors={errors("expiryDate")}
        >
          <Input name="expiryDate" type="date" />
        </FormField>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="shareWithAgency" defaultChecked className="mt-1 size-4" />
        <span>
          Share this credential with <strong>{organisationName}</strong> so they can review it. You
          can stop sharing at any time. Other agencies see it only if you share it with them too.
        </span>
      </label>
      <SubmitButton className="w-fit">Add credential</SubmitButton>
    </form>
  );
}
