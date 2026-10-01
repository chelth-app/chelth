"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

import { updateRequirementAction } from "../actions";
import type { Requirement } from "../queries";

/** Deactivation records an explicit last day (a calendar date), never the server's UTC date. */
export function DeactivateRequirementForm({
  organisationId,
  facilityId,
  requirement,
  name,
  defaultLastDay,
}: {
  organisationId: string;
  facilityId?: string;
  requirement: Requirement;
  name: string;
  defaultLastDay?: string;
}) {
  const [state, formAction] = useActionState(updateRequirementAction, null);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-primary">Deactivate</summary>
      <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2" noValidate>
        <input type="hidden" name="organisationId" value={organisationId} />
        {facilityId ? <input type="hidden" name="facilityId" value={facilityId} /> : null}
        <input type="hidden" name="requirementId" value={requirement.id} />
        <input type="hidden" name="mustBeVerified" value={String(requirement.mustBeVerified)} />
        <input
          type="hidden"
          name="minimumValidityDays"
          value={String(requirement.minimumValidityDays)}
        />
        <input
          type="hidden"
          name="expiryWarningDays"
          value={String(requirement.expiryWarningDays)}
        />
        <input type="hidden" name="status" value="inactive" />
        <FormField
          id={`deactivate-${requirement.id}`}
          label="Last day it applies"
          required
          errors={fieldErrorsFor(state, "effectiveUntil")}
        >
          <Input
            name="effectiveUntil"
            type="date"
            min={requirement.effectiveFrom}
            defaultValue={defaultLastDay ?? ""}
          />
        </FormField>
        <SubmitButton
          size="sm"
          variant="outline"
          className="w-fit"
          aria-label={`Deactivate ${name}`}
        >
          Deactivate
        </SubmitButton>
        <FormAlert state={state} className="p-2 text-xs" />
      </form>
    </details>
  );
}
