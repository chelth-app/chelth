"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ASSIGNMENT_CANCELLATION_REASON_LABELS,
  ASSIGNMENT_CANCELLATION_REASONS,
  MAX_REQUESTED_HEADCOUNT,
  SHIFT_CANCELLATION_REASON_LABELS,
  SHIFT_CANCELLATION_REASONS,
} from "@/lib/domain/shifts";

import {
  addShiftNoteAction,
  cancelAssignmentAction,
  cancelShiftAction,
  updateShiftDetailsAction,
} from "../actions";

type ShiftRef = { organisationId: string; shiftId: string };

export function CancelShiftForm({ organisationId, shiftId }: ShiftRef) {
  const [state, formAction] = useActionState(cancelShiftAction, null);
  return (
    <form
      action={formAction}
      className="flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end"
      noValidate
    >
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="shiftId" value={shiftId} />
      <FormField
        id="cancel-shift-reason"
        label="Cancellation reason"
        required
        errors={fieldErrorsFor(state, "reason")}
      >
        <Select name="reason" defaultValue="">
          <option value="" disabled>
            Choose a reason
          </option>
          {SHIFT_CANCELLATION_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {SHIFT_CANCELLATION_REASON_LABELS[reason]}
            </option>
          ))}
        </Select>
      </FormField>
      <SubmitButton variant="outline" className="w-fit">
        Cancel shift
      </SubmitButton>
      <FormAlert state={state} successMessage="Shift cancelled." />
    </form>
  );
}

export function CancelAssignmentForm({
  organisationId,
  shiftId,
  assignmentId,
  workerName,
}: ShiftRef & { assignmentId: string; workerName: string }) {
  const [state, formAction] = useActionState(cancelAssignmentAction, null);
  const id = `cancel-assignment-${assignmentId}`;
  return (
    <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-end" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="shiftId" value={shiftId} />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <FormField
        id={id}
        label={`Reason to remove ${workerName}`}
        errors={fieldErrorsFor(state, "reason")}
      >
        <Select name="reason" defaultValue="">
          <option value="" disabled>
            Choose a reason
          </option>
          {ASSIGNMENT_CANCELLATION_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {ASSIGNMENT_CANCELLATION_REASON_LABELS[reason]}
            </option>
          ))}
        </Select>
      </FormField>
      <SubmitButton
        variant="outline"
        size="sm"
        className="w-fit"
        aria-label={`Remove ${workerName}`}
      >
        Remove
      </SubmitButton>
      <FormAlert state={state} className="p-2 text-xs" />
    </form>
  );
}

export function ShiftDetailsForm({
  organisationId,
  shiftId,
  requestedHeadcount,
  instructions,
  externalReference,
  unitLabel,
}: ShiftRef & {
  requestedHeadcount: number;
  instructions: string | null;
  externalReference: string | null;
  unitLabel: string | null;
}) {
  const [state, formAction] = useActionState(updateShiftDetailsAction, null);
  return (
    <form action={formAction} className="grid max-w-3xl gap-3 sm:grid-cols-2" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="shiftId" value={shiftId} />
      <FormField
        id="details-headcount"
        label="Workers needed"
        required
        errors={fieldErrorsFor(state, "requestedHeadcount")}
      >
        <Input
          name="requestedHeadcount"
          type="number"
          min={1}
          max={MAX_REQUESTED_HEADCOUNT}
          defaultValue={requestedHeadcount}
          inputMode="numeric"
        />
      </FormField>
      <FormField
        id="details-reference"
        label="Reference"
        errors={fieldErrorsFor(state, "externalReference")}
      >
        <Input name="externalReference" defaultValue={externalReference ?? ""} autoComplete="off" />
      </FormField>
      <FormField
        id="details-unit"
        label="Unit / department"
        description="Optional, e.g. ICU or Ward 3. Shown to assigned workers."
        errors={fieldErrorsFor(state, "unitLabel")}
      >
        <Input name="unitLabel" maxLength={80} defaultValue={unitLabel ?? ""} autoComplete="off" />
      </FormField>
      <FormField
        id="details-instructions"
        label="Instructions for workers"
        description="Visible to the facility and assigned workers. Never include patient information."
        errors={fieldErrorsFor(state, "instructions")}
        className="sm:col-span-2"
      >
        <Textarea name="instructions" rows={3} maxLength={2000} defaultValue={instructions ?? ""} />
      </FormField>
      <SubmitButton variant="outline" className="w-fit">
        Save details
      </SubmitButton>
      <FormAlert state={state} successMessage="Shift updated." className="sm:col-span-2" />
    </form>
  );
}

export function ShiftNoteForm({ organisationId, shiftId }: ShiftRef) {
  const [state, formAction] = useActionState(addShiftNoteAction, null);
  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-3" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="shiftId" value={shiftId} />
      <FormField
        id="shift-note"
        label="Internal note"
        description="Only your agency can read internal notes."
        required
        errors={fieldErrorsFor(state, "body")}
      >
        <Textarea name="body" rows={2} maxLength={2000} />
      </FormField>
      <SubmitButton variant="outline" className="w-fit">
        Add note
      </SubmitButton>
      <FormAlert state={state} successMessage="Note added." />
    </form>
  );
}
