"use client";

import { useActionState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { InlineActionForm } from "@/components/forms/inline-action-form";
import { SubmitButton } from "@/components/forms/submit-button";

import { acceptOfferAction, declineOfferAction } from "../actions";

type RespondToOfferProps = { organisationId: string; offerId: string; facilityName: string };

/** Accept (server re-runs the full assignment gate) or decline an offer. */
export function RespondToOffer({ organisationId, offerId, facilityName }: RespondToOfferProps) {
  const [state, formAction] = useActionState(acceptOfferAction, null);
  const reasons = state && !state.ok ? (state.error.fieldErrors?.reasons ?? []) : [];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <form action={formAction}>
          <input type="hidden" name="organisationId" value={organisationId} />
          <input type="hidden" name="offerId" value={offerId} />
          <SubmitButton size="sm" aria-label={`Accept offer at ${facilityName}`}>
            Accept
          </SubmitButton>
        </form>
        <InlineActionForm
          action={declineOfferAction}
          fields={{ organisationId, offerId }}
          label="Decline"
          accessibleLabel={`Decline offer at ${facilityName}`}
        />
      </div>
      {state && !state.ok ? (
        <div className="flex flex-col gap-1">
          <FormAlert state={state} className="p-2 text-xs" />
          {reasons.length > 0 ? (
            <ul aria-label="Why this offer cannot be accepted" className="list-disc pl-5 text-xs">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
