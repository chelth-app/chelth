"use client";

import { useActionState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";

import { endBreakAction, startBreakAction } from "../actions";

type BreakControlProps = {
  organisationId: string;
  assignmentId: string;
  kind: "start" | "end";
  facilityName: string;
};

/** Large, mobile-first break button. Server time; no location is ever requested. */
export function BreakControl({
  organisationId,
  assignmentId,
  kind,
  facilityName,
}: BreakControlProps) {
  const [state, formAction] = useActionState(
    kind === "start" ? startBreakAction : endBreakAction,
    null,
  );
  const label = kind === "start" ? "Start break" : "End break";
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <SubmitButton
        size="lg"
        variant={kind === "start" ? "outline" : "primary"}
        className="w-full sm:w-auto"
        aria-label={`${label} at ${facilityName}`}
      >
        {label}
      </SubmitButton>
      {state && !state.ok ? <FormAlert state={state} /> : null}
    </form>
  );
}
