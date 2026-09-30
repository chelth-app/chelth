"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { OFFER_EXPIRY_OPTIONS } from "@/lib/domain/shifts";

import { offerShiftAction } from "../actions";

type OfferShiftFormProps = {
  organisationId: string;
  shiftId: string;
  candidates: { workerId: string; name: string }[];
};

/**
 * Broadcast an offer to chosen eligible workers. No ranking: workers are
 * listed alphabetically. Offers reserve no headcount; the first valid
 * acceptances fill the shift and the rest close automatically.
 */
export function OfferShiftForm({ organisationId, shiftId, candidates }: OfferShiftFormProps) {
  const [state, formAction] = useActionState(offerShiftAction, null);
  const workerErrors = fieldErrorsFor(state, "workerIds");
  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-3" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="shiftId" value={shiftId} />
      <fieldset
        className="flex flex-col gap-2"
        aria-describedby={workerErrors ? "offer-workers-error" : undefined}
      >
        <legend className="mb-1 text-sm font-medium">Workers to offer this shift to</legend>
        {candidates.map((candidate) => (
          <label key={candidate.workerId} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="workerId" value={candidate.workerId} className="size-4" />
            {candidate.name}
          </label>
        ))}
        {workerErrors ? (
          <p id="offer-workers-error" className="text-sm text-danger">
            {workerErrors.join(" ")}
          </p>
        ) : null}
      </fieldset>
      <FormField
        id="offer-expiry"
        label="Offer stays open for"
        description="Never beyond the shift start."
        errors={fieldErrorsFor(state, "expiresInMinutes")}
      >
        <Select name="expiresInMinutes" defaultValue="1440">
          {OFFER_EXPIRY_OPTIONS.map((option) => (
            <option key={option.minutes} value={option.minutes}>
              {option.label}
            </option>
          ))}
        </Select>
      </FormField>
      <SubmitButton variant="outline" className="w-fit">
        Send offers
      </SubmitButton>
      <FormAlert
        state={state}
        successMessage={
          state?.ok
            ? `${state.data.offered} offer(s) sent${state.data.skipped ? `, ${state.data.skipped} skipped (no longer eligible or already offered)` : ""}.`
            : undefined
        }
      />
    </form>
  );
}
