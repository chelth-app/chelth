"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ATTENDANCE_CORRECTION_REASONS,
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
          <option value="clock_in">Clock-in time</option>
          <option value="clock_out">Clock-out time</option>
        </Select>
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

type ReviewProps = { organisationId: string; correctionId: string; workerName: string };

export function CorrectionReviewForms({ organisationId, correctionId, workerName }: ReviewProps) {
  const [approveState, approveAction] = useActionState(reviewCorrectionAction, null);
  const [rejectState, rejectAction] = useActionState(reviewCorrectionAction, null);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <form action={approveAction}>
        <input type="hidden" name="organisationId" value={organisationId} />
        <input type="hidden" name="correctionId" value={correctionId} />
        <input type="hidden" name="decision" value="approve" />
        <input type="hidden" name="resolution" value="approved_as_requested" />
        <SubmitButton size="sm" aria-label={`Approve correction for ${workerName}`}>
          Approve
        </SubmitButton>
        <FormAlert state={approveState} className="mt-1 p-2 text-xs" />
      </form>
      <form action={rejectAction} className="flex flex-col gap-1 sm:flex-row sm:items-end sm:gap-2">
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
  );
}
