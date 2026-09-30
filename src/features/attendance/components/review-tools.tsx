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
  CORRECTABLE_EVENT_LABELS,
  CORRECTABLE_EVENT_TYPES,
  EVIDENCE_RETENTION_BOUNDS,
} from "@/lib/domain/attendance";

import {
  adjustAttendanceAction,
  placeLegalHoldAction,
  releaseLegalHoldAction,
  saveRetentionAction,
} from "../actions";

/**
 * Reviewer-originated adjustment. It appends a corrected event with a required
 * reason; the original event stays and the worker is told.
 */
export function AdjustAttendanceForm({
  organisationId,
  attendanceId,
  timezone,
  defaultDate,
}: {
  organisationId: string;
  attendanceId: string;
  timezone: string;
  defaultDate: string;
}) {
  const [state, formAction] = useActionState(adjustAttendanceAction, null);
  const id = (field: string) => `adjust-${attendanceId}-${field}`;
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="attendanceId" value={attendanceId} />
      <input type="hidden" name="timezone" value={timezone} />
      <FormField
        id={id("type")}
        label="Time to set"
        required
        errors={fieldErrorsFor(state, "eventType")}
      >
        <Select name="eventType" defaultValue="clock_out">
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
        description="Only for break times."
        errors={fieldErrorsFor(state, "segment")}
      >
        <Input name="segment" type="number" min={1} max={20} defaultValue={1} inputMode="numeric" />
      </FormField>
      <FormField id={id("date")} label="Date" required errors={fieldErrorsFor(state, "date")}>
        <Input name="date" type="date" defaultValue={defaultDate} />
      </FormField>
      <FormField
        id={id("time")}
        label="Time"
        description={`Local time at the facility (${timezone}).`}
        required
        errors={fieldErrorsFor(state, "time")}
      >
        <Input name="time" type="time" />
      </FormField>
      <FormField
        id={id("reason")}
        label="Reason"
        required
        errors={fieldErrorsFor(state, "adjustmentReason")}
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
        description="Optional. The worker sees this note."
        errors={fieldErrorsFor(state, "note")}
      >
        <Textarea name="note" rows={2} maxLength={500} />
      </FormField>
      <label htmlFor={id("confirm")} className="flex items-start gap-2 text-sm sm:col-span-2">
        <input
          id={id("confirm")}
          type="checkbox"
          name="confirmRevision"
          className="mt-0.5 size-4"
        />
        <span>
          If this shift is on an approved timesheet, create a new revision for re-approval.
        </span>
      </label>
      <SubmitButton variant="outline" className="w-fit">
        Record adjusted time
      </SubmitButton>
      <FormAlert state={state} successMessage="Adjustment recorded." className="sm:col-span-2" />
    </form>
  );
}

export function RetentionForm({
  organisationId,
  retentionDays,
}: {
  organisationId: string;
  retentionDays: number;
}) {
  const [state, formAction] = useActionState(saveRetentionAction, null);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <FormField
        id="retention-days"
        label="Keep raw location evidence for (days)"
        description={`${EVIDENCE_RETENTION_BOUNDS.min}–${EVIDENCE_RETENTION_BOUNDS.max} days. Results such as "Inside site area" are kept with attendance.`}
        errors={fieldErrorsFor(state, "retentionDays")}
      >
        <Input
          name="retentionDays"
          type="number"
          min={EVIDENCE_RETENTION_BOUNDS.min}
          max={EVIDENCE_RETENTION_BOUNDS.max}
          defaultValue={retentionDays}
          inputMode="numeric"
        />
      </FormField>
      <SubmitButton variant="outline" className="w-fit">
        Save retention
      </SubmitButton>
      <FormAlert state={state} successMessage="Saved." />
    </form>
  );
}

export function PlaceHoldForm({
  organisationId,
  attendanceId,
}: {
  organisationId: string;
  attendanceId: string;
}) {
  const [state, formAction] = useActionState(placeLegalHoldAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-2" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="attendanceId" value={attendanceId} />
      <FormField
        id={`hold-reason-${attendanceId}`}
        label="Reason for the legal hold"
        description="Stored with the hold; never written to the audit log."
        required
        errors={fieldErrorsFor(state, "reason")}
      >
        <Textarea name="reason" rows={2} maxLength={300} />
      </FormField>
      <SubmitButton variant="outline" className="w-fit">
        Place legal hold
      </SubmitButton>
      <FormAlert
        state={state}
        successMessage="Legal hold placed. This evidence will not be purged."
      />
    </form>
  );
}

export function ReleaseHoldForm({
  organisationId,
  attendanceId,
  holdId,
}: {
  organisationId: string;
  attendanceId: string;
  holdId: string;
}) {
  const [state, formAction] = useActionState(releaseLegalHoldAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="attendanceId" value={attendanceId} />
      <input type="hidden" name="holdId" value={holdId} />
      <SubmitButton size="sm" variant="outline" className="w-fit">
        Release hold
      </SubmitButton>
      <FormAlert state={state} className="p-2 text-xs" />
    </form>
  );
}
