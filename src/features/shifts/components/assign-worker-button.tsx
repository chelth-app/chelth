"use client";

import { useActionState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import type { ButtonProps } from "@/components/ui/button";

import { assignWorkerAction } from "../actions";

type AssignWorkerButtonProps = {
  organisationId: string;
  shiftId: string;
  workerId: string;
  workerName: string;
  label: string;
  variant?: ButtonProps["variant"];
};

/**
 * Posts one assignment attempt. The server decides; a refusal shows the
 * structured reason and the plain-language explanation it returns.
 */
export function AssignWorkerButton({
  organisationId,
  shiftId,
  workerId,
  workerName,
  label,
  variant = "primary",
}: AssignWorkerButtonProps) {
  const [state, formAction] = useActionState(assignWorkerAction, null);
  const reasons = state && !state.ok ? (state.error.fieldErrors?.reasons ?? []) : [];
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="shiftId" value={shiftId} />
      <input type="hidden" name="workerId" value={workerId} />
      <SubmitButton variant={variant} size="sm" aria-label={`${label}: ${workerName}`}>
        {label}
      </SubmitButton>
      {state && !state.ok ? (
        <div className="flex flex-col gap-1">
          <FormAlert state={state} className="p-2 text-xs" />
          {reasons.length > 0 ? (
            <ul
              aria-label={`Why ${workerName} cannot be assigned`}
              className="list-disc pl-5 text-xs"
            >
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
