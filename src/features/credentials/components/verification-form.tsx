"use client";

import { useActionState, useState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { REJECTION_REASON_LABELS, REJECTION_REASONS } from "@/lib/domain/credentials";

import { recordVerificationAction } from "../actions";

type VerificationFormProps = {
  organisationId: string;
  workerId: string;
  credentialId: string;
  versionId: string;
  versionLabel: string;
  /** Facility-scoped credentials are verified for one of the agency's facilities. */
  facilities: { id: string; name: string }[] | null;
};

export function VerificationForm(props: VerificationFormProps) {
  const [state, formAction] = useActionState(recordVerificationAction, null);
  const [outcome, setOutcome] = useState("verified");
  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3" noValidate>
      <FormAlert state={state} successMessage="Decision recorded." />
      <input type="hidden" name="organisationId" value={props.organisationId} />
      <input type="hidden" name="workerId" value={props.workerId} />
      <input type="hidden" name="credentialId" value={props.credentialId} />
      <input type="hidden" name="versionId" value={props.versionId} />
      <p className="text-sm text-muted-foreground">
        Recording a decision for {props.versionLabel}.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          id="verification-outcome"
          label="Decision"
          required
          errors={fieldErrorsFor(state, "outcome")}
        >
          <Select
            name="outcome"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
          >
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
            <option value="under_review">Under review</option>
          </Select>
        </FormField>
        {outcome === "rejected" ? (
          <FormField
            id="verification-reason"
            label="Reason"
            required
            errors={fieldErrorsFor(state, "rejectionReason")}
          >
            <Select name="rejectionReason" defaultValue="">
              <option value="" disabled>
                Choose a reason
              </option>
              {REJECTION_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {REJECTION_REASON_LABELS[reason]}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}
        {props.facilities ? (
          <FormField
            id="verification-facility"
            label="For facility"
            required
            errors={fieldErrorsFor(state, "facilityId")}
          >
            <Select name="facilityId" defaultValue="">
              <option value="" disabled>
                Choose a facility
              </option>
              {props.facilities.map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.name}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}
      </div>
      <SubmitButton className="w-fit">Record decision</SubmitButton>
    </form>
  );
}
