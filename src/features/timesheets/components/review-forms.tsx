"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DISPUTE_REASON_LABELS,
  REJECTION_REASON_LABELS,
  REOPEN_REASON_LABELS,
  TIMESHEET_DISPUTE_REASONS,
  TIMESHEET_REJECTION_REASONS,
  TIMESHEET_REOPEN_REASONS,
  WEEKDAY_LABELS,
} from "@/lib/domain/timesheets";

import {
  approveTimesheetAction,
  facilityDecisionAction,
  rejectTimesheetAction,
  reopenTimesheetAction,
  resolveDisputeAction,
  saveWeekStartAction,
  submitTimesheetAction,
} from "../actions";

type TimesheetRef = { organisationId: string; timesheetId: string };

export function SubmitTimesheetForm({ organisationId, timesheetId }: TimesheetRef) {
  const [state, formAction] = useActionState(submitTimesheetAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="timesheetId" value={timesheetId} />
      <SubmitButton size="lg" className="w-full sm:w-fit">
        Submit timesheet
      </SubmitButton>
      <FormAlert state={state} successMessage="Submitted. Your agency will review it." />
    </form>
  );
}

/** Agency decision on a submitted timesheet. Times are never edited here. */
export function ApproveTimesheetForms({
  organisationId,
  timesheetId,
  revision,
  canApprove,
}: TimesheetRef & { revision: number; canApprove: boolean }) {
  const [approveState, approveAction] = useActionState(approveTimesheetAction, null);
  const [rejectState, rejectAction] = useActionState(rejectTimesheetAction, null);
  return (
    <div className="flex flex-col gap-4">
      {canApprove ? (
        <form action={approveAction} className="flex flex-col gap-2">
          <input type="hidden" name="organisationId" value={organisationId} />
          <input type="hidden" name="timesheetId" value={timesheetId} />
          <input type="hidden" name="revision" value={revision} />
          <SubmitButton className="w-fit">Approve timesheet</SubmitButton>
          <FormAlert state={approveState} successMessage="Approved." />
        </form>
      ) : null}
      <details className="text-sm">
        <summary className="cursor-pointer text-primary">Return to worker</summary>
        <form action={rejectAction} className="mt-3 grid max-w-xl gap-3" noValidate>
          <input type="hidden" name="organisationId" value={organisationId} />
          <input type="hidden" name="timesheetId" value={timesheetId} />
          <FormField
            id={`reject-reason-${timesheetId}`}
            label="Reason"
            required
            errors={fieldErrorsFor(rejectState, "reason")}
          >
            <Select name="reason" defaultValue="">
              <option value="" disabled>
                Choose a reason
              </option>
              {TIMESHEET_REJECTION_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {REJECTION_REASON_LABELS[reason]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            id={`reject-note-${timesheetId}`}
            label="Note for the worker"
            description="Optional. The worker sees this note."
            errors={fieldErrorsFor(rejectState, "note")}
          >
            <Textarea name="note" rows={2} maxLength={500} />
          </FormField>
          <SubmitButton variant="outline" className="w-fit">
            Return timesheet
          </SubmitButton>
          <FormAlert state={rejectState} successMessage="Returned to the worker." />
        </form>
      </details>
    </div>
  );
}

export function ReopenTimesheetForm({ organisationId, timesheetId }: TimesheetRef) {
  const [state, formAction] = useActionState(reopenTimesheetAction, null);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-primary">Reopen timesheet</summary>
      <form action={formAction} className="mt-3 grid max-w-xl gap-3" noValidate>
        <input type="hidden" name="organisationId" value={organisationId} />
        <input type="hidden" name="timesheetId" value={timesheetId} />
        <p className="text-muted-foreground">
          Reopening supersedes the approval and any facility sign-offs, creates a new revision and
          returns the timesheet to the worker. Nothing is deleted.
        </p>
        <FormField
          id={`reopen-reason-${timesheetId}`}
          label="Reason"
          required
          errors={fieldErrorsFor(state, "reason")}
        >
          <Select name="reason" defaultValue="">
            <option value="" disabled>
              Choose a reason
            </option>
            {TIMESHEET_REOPEN_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {REOPEN_REASON_LABELS[reason]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          id={`reopen-note-${timesheetId}`}
          label="Note"
          errors={fieldErrorsFor(state, "note")}
        >
          <Textarea name="note" rows={2} maxLength={500} />
        </FormField>
        <SubmitButton variant="outline" className="w-fit">
          Reopen as a new revision
        </SubmitButton>
        <FormAlert state={state} successMessage="Reopened." />
      </form>
    </details>
  );
}

export function ResolveDisputeForm({
  organisationId,
  timesheetId,
  entryId,
}: TimesheetRef & { entryId: string }) {
  const [state, formAction] = useActionState(resolveDisputeAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="timesheetId" value={timesheetId} />
      <input type="hidden" name="entryId" value={entryId} />
      <FormField id={`resolve-note-${entryId}`} label="Reply to the facility (optional)">
        <Textarea name="note" rows={2} maxLength={500} />
      </FormField>
      <SubmitButton size="sm" variant="outline" className="w-fit">
        Confirm times stand
      </SubmitButton>
      <FormAlert state={state} className="p-2 text-xs" />
    </form>
  );
}

/** Facility decision on ONE entry at its own facility: sign off or raise a discrepancy. */
export function FacilityDecisionForms({
  organisationId,
  entryId,
  revision,
  workerName,
}: {
  organisationId: string;
  entryId: string;
  revision: number;
  workerName: string;
}) {
  const [signState, signAction] = useActionState(facilityDecisionAction, null);
  const [disputeState, disputeAction] = useActionState(facilityDecisionAction, null);
  return (
    <div className="flex flex-col gap-2">
      <form action={signAction}>
        <input type="hidden" name="organisationId" value={organisationId} />
        <input type="hidden" name="entryId" value={entryId} />
        <input type="hidden" name="revision" value={revision} />
        <input type="hidden" name="decision" value="sign_off" />
        <SubmitButton size="sm" aria-label={`Sign off ${workerName}`}>
          Sign off
        </SubmitButton>
        <FormAlert state={signState} className="mt-1 p-2 text-xs" />
      </form>
      <details className="text-sm">
        <summary className="cursor-pointer text-primary">Raise a discrepancy</summary>
        <form action={disputeAction} className="mt-2 grid gap-2" noValidate>
          <input type="hidden" name="organisationId" value={organisationId} />
          <input type="hidden" name="entryId" value={entryId} />
          <input type="hidden" name="revision" value={revision} />
          <input type="hidden" name="decision" value="dispute" />
          <FormField
            id={`dispute-reason-${entryId}`}
            label={`What is wrong for ${workerName}?`}
            required
            errors={fieldErrorsFor(disputeState, "reason")}
          >
            <Select name="reason" defaultValue="">
              <option value="" disabled>
                Choose what is wrong
              </option>
              {TIMESHEET_DISPUTE_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {DISPUTE_REASON_LABELS[reason]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            id={`dispute-note-${entryId}`}
            label="Details for the agency (optional)"
            errors={fieldErrorsFor(disputeState, "note")}
          >
            <Textarea name="note" rows={2} maxLength={500} />
          </FormField>
          <SubmitButton size="sm" variant="outline" className="w-fit">
            Send discrepancy
          </SubmitButton>
          <FormAlert state={disputeState} className="p-2 text-xs" />
        </form>
      </details>
    </div>
  );
}

export function WeekStartForm({
  organisationId,
  weekStartsOn,
}: {
  organisationId: string;
  weekStartsOn: number;
}) {
  const [state, formAction] = useActionState(saveWeekStartAction, null);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="organisationId" value={organisationId} />
      <FormField id="week-starts-on" label="Timesheet week starts on">
        <Select name="weekStartsOn" defaultValue={String(weekStartsOn)}>
          {Object.entries(WEEKDAY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </FormField>
      <SubmitButton variant="outline" className="w-fit">
        Save week start
      </SubmitButton>
      <FormAlert state={state} successMessage="Saved." />
    </form>
  );
}
