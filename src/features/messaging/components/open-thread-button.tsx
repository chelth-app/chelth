"use client";

import { useActionState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";

import { openFacilityThreadAction, openWorkerThreadAction } from "../actions";

/** Opens (or reuses) the right thread and navigates to it. */
export function OpenThreadButton({
  organisationId,
  target,
  label,
  className,
  variant = "outline",
  surface = "staff",
  children,
}: {
  organisationId: string;
  /** The worker app (Messages) or the staff workspace (Conversations). */
  surface?: "worker" | "staff";
  target:
    | { kind: "worker"; agencyWorkerId: string; shiftId?: string }
    | { kind: "facility"; relationshipId: string; shiftId?: string };
  label: string;
  className?: string;
  variant?: "primary" | "outline";
  children?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(
    target.kind === "worker" ? openWorkerThreadAction : openFacilityThreadAction,
    null,
  );
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="surface" value={surface} />
      {target.kind === "worker" ? (
        <input type="hidden" name="agencyWorkerId" value={target.agencyWorkerId} />
      ) : (
        <input type="hidden" name="relationshipId" value={target.relationshipId} />
      )}
      {target.shiftId ? <input type="hidden" name="shiftId" value={target.shiftId} /> : null}
      <SubmitButton variant={variant} className={className}>
        {children}
        {label}
      </SubmitButton>
      {state && !state.ok ? <FormAlert state={state} className="p-2 text-xs" /> : null}
    </form>
  );
}
