"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { updateWorkerContextAction } from "../actions";

export type WorkerContextValues = {
  parkingInstructions: string;
  arrivalInstructions: string;
  workerContactLabel: string;
  workerContactPhone: string;
};

/**
 * Arrival guidance and the worker-facing contact (P0-E9-3D-S2). Shown to
 * workers only while they hold an active assignment at this facility. The
 * contact is a role or desk with a business phone — never a personal contact.
 */
export function WorkerContextForm({
  organisationId,
  facilityId,
  values,
}: {
  organisationId: string;
  facilityId: string;
  values: WorkerContextValues;
}) {
  const [state, formAction] = useActionState(updateWorkerContextAction, null);
  const errors = (field: string) => fieldErrorsFor(state, field);
  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4" noValidate>
      <FormAlert state={state} successMessage="Worker arrival information saved." />
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="facilityId" value={facilityId} />
      <FormField
        id="worker-parking"
        label="Parking"
        description="Where workers can park. Up to 500 characters."
        errors={errors("parkingInstructions")}
      >
        <Textarea
          name="parkingInstructions"
          rows={2}
          maxLength={500}
          defaultValue={values.parkingInstructions}
        />
      </FormField>
      <FormField
        id="worker-arrival"
        label="Arrival and check-in"
        description="Entrance to use and where to report. Each shift's own instructions add to this."
        errors={errors("arrivalInstructions")}
      >
        <Textarea
          name="arrivalInstructions"
          rows={2}
          maxLength={500}
          defaultValue={values.arrivalInstructions}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="worker-contact-label"
          label="Contact for workers"
          description="A role or desk, e.g. Nursing supervisor desk."
          errors={errors("workerContactLabel")}
        >
          <Input
            name="workerContactLabel"
            maxLength={80}
            autoComplete="off"
            defaultValue={values.workerContactLabel}
          />
        </FormField>
        <FormField
          id="worker-contact-phone"
          label="Contact phone"
          description="A business number workers can call."
          errors={errors("workerContactPhone")}
        >
          <Input
            name="workerContactPhone"
            type="tel"
            autoComplete="off"
            defaultValue={values.workerContactPhone}
          />
        </FormField>
      </div>
      <SubmitButton className="w-fit">Save arrival information</SubmitButton>
    </form>
  );
}
