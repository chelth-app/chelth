"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ADJUSTMENT_REASON_LABELS,
  ATTENDANCE_ADJUSTMENT_REASONS,
  ATTENDANCE_CORRECTION_REASONS,
  CORRECTABLE_EVENT_LABELS,
  CORRECTABLE_EVENT_TYPES,
  CORRECTION_REASON_LABELS,
  CORRECTION_RESOLUTION_LABELS,
  REJECTION_RESOLUTIONS,
} from "@/lib/domain/attendance";

import { requestCorrectionAction, reviewCorrectionAction } from "../actions";

type RequestProps = {
  organisationId: string;
  assignmentId: string;
  timezone: string;
  defaultDate: string;
};

/** Worker asks for a corrected time. Nothing changes until the agency approves. */
export function CorrectionRequestForm({
  organisationId,
  assignmentId,
  timezone,
  defaultDate,
}: RequestProps) {
  const [state, formAction] = useActionState(requestCorrectionAction, null);
  const id = (field: string) => `correction-${assignmentId}-${field}`;
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="timezone" value={timezone} />
      <FormField
        id={id("type")}
        label="Which time?"
        required
        errors={fieldErrorsFor(state, "eventType")}
      >
        <Select name="eventType" defaultValue="clock_in">
          {CORRECTABLE_EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {CORRECTABLE_EVENT_LABELS[type]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        id={id("segment")}
        label="Break number"
        description="Only for break times: 1 for your first break, 2 for the second."
        errors={fieldErrorsFor(state, "segment")}
      >
        <Input name="segment" type="number" min={1} max={20} defaultValue={1} inputMode="numeric" />
      </FormField>
      <FormField id={id("reason")} label="Reason" required errors={fieldErrorsFor(state, "reason")}>
        <Select name="reason" defaultValue="">
          <option value="" disabled>
            Choose a reason
          </option>
          {ATTENDANCE_CORRECTION_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {CORRECTION_REASON_LABELS[reason]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField id={id("date")} label="Date" required errors={fieldErrorsFor(state, "date")}>
        <Input name="date" type="date" defaultValue={defaultDate} />
      </FormField>
      <FormField
        id={id("time")}
        label="Actual time"
        description={`Local time at the facility (${timezone}).`}
        required
        errors={fieldErrorsFor(state, "time")}
      >
        <Input name="time" type="time" />
      </FormField>
      <FormField
        id={id("note")}
        label="Note for your agency"
        description="Optional. Visible to your agency only."
        errors={fieldErrorsFor(state, "note")}
        className="sm:col-span-2"
      >
        <Textarea name="note" rows={2} maxLength={500} />
      </FormField>
      <SubmitButton variant="outline" className="w-fit">
        Send correction request
      </SubmitButton>
      <FormAlert
        state={state}
        successMessage="Correction requested. Your agency will review it."
        className="sm:col-span-2"
      />
    </form>
  );
}

type ReviewProps = {
  organisationId: string;
  correctionId: string;
  workerName: string;
  timezone: string;
  defaultDate: string;
};

/** A checkbox the reviewer must tick to change time on an approved timesheet. */
function ConfirmRevision({ id }: { id: string }) {
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-xs text-muted-foreground">
      <input id={id} type="checkbox" name="confirmRevision" className="mt-0.5 size-4" />
      <span>If this shift is on an approved timesheet, create a new revision for re-approval.</span>
    </label>
  );
}

export function CorrectionReviewForms({
  organisationId,
  correctionId,
  workerName,
  timezone,
  defaultDate,
}: ReviewProps) {
  const [approveState, approveAction] = useActionState(reviewCorrectionAction, null);
  const [adjustState, adjustAction] = useActionState(reviewCorrectionAction, null);
  const [rejectState, rejectAction] = useActionState(reviewCorrectionAction, null);
  const id = (field: string) => `review-${correctionId}-${field}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <form action={approveAction} className="flex flex-col gap-1">
          <input type="hidden" name="organisationId" value={organisationId} />
          <input type="hidden" name="correctionId" value={correctionId} />
          <input type="hidden" name="decision" value="approve" />
          <SubmitButton
            size="sm"
            className="w-fit"
            aria-label={`Approve correction for ${workerName}`}
          >
            Approve
          </SubmitButton>
          <ConfirmRevision id={id("confirm-approve")} />
          <FormAlert state={approveState} className="mt-1 p-2 text-xs" />
        </form>
        <form
          action={rejectAction}
          className="flex flex-col gap-1 sm:flex-row sm:items-end sm:gap-2"
        >
          <input type="hidden" name="organisationId" value={organisationId} />
          <input type="hidden" name="correctionId" value={correctionId} />
          <input type="hidden" name="decision" value="reject" />
          <FormField id={`reject-${correctionId}`} label={`Reason to decline for ${workerName}`}>
            <Select name="resolution" defaultValue="rejected_time_not_supported">
              {REJECTION_RESOLUTIONS.map((resolution) => (
                <option key={resolution} value={resolution}>
                  {CORRECTION_RESOLUTION_LABELS[resolution]}
                </option>
              ))}
            </Select>
          </FormField>
          <SubmitButton
            size="sm"
            variant="outline"
            aria-label={`Decline correction for ${workerName}`}
          >
            Decline
          </SubmitButton>
          <FormAlert state={rejectState} className="p-2 text-xs" />
        </form>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-primary">Approve a different time</summary>
        <form action={adjustAction} className="mt-3 grid gap-3 sm:grid-cols-2" noValidate>
          <input type="hidden" name="organisationId" value={organisationId} />
          <input type="hidden" name="correctionId" value={correctionId} />
          <input type="hidden" name="decision" value="adjust" />
          <input type="hidden" name="timezone" value={timezone} />
          <FormField
            id={id("date")}
            label="Date"
            required
            errors={fieldErrorsFor(adjustState, "date")}
          >
            <Input name="date" type="date" defaultValue={defaultDate} />
          </FormField>
          <FormField
            id={id("time")}
            label="Approved time"
            description={`Local time at the facility (${timezone}).`}
            required
            errors={fieldErrorsFor(adjustState, "time")}
          >
            <Input name="time" type="time" />
          </FormField>
          <FormField
            id={id("reason")}
            label="Reason for the different time"
            required
            errors={fieldErrorsFor(adjustState, "adjustmentReason")}
          >
            <Select name="adjustmentReason" defaultValue="">
              <option value="" disabled>
                Choose a reason
              </option>
              {ATTENDANCE_ADJUSTMENT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {ADJUSTMENT_REASON_LABELS[reason]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            id={id("note")}
            label="Note for the worker"
            description="Optional. The worker sees this note with the change."
            errors={fieldErrorsFor(adjustState, "note")}
          >
            <Textarea name="note" rows={2} maxLength={500} />
          </FormField>
          <ConfirmRevision id={id("confirm-adjust")} />
          <SubmitButton
            size="sm"
            variant="outline"
            className="w-fit"
            aria-label={`Approve a different time for ${workerName}`}
          >
            Approve different time
          </SubmitButton>
          <FormAlert state={adjustState} className="p-2 text-xs sm:col-span-2" />
        </form>
      </details>
    </div>
  );
}
