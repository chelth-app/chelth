import type { ActionResult } from "@/lib/errors";
import { cn } from "@/lib/utils/cn";

type FormAlertProps = {
  state: ActionResult<unknown> | null;
  /** Message shown on success; omit to show nothing. */
  successMessage?: string;
  className?: string;
};

/**
 * Form-level outcome. Errors use role="alert" so screen readers announce them;
 * only the safe PublicError message is ever displayed.
 */
export function FormAlert({ state, successMessage, className }: FormAlertProps) {
  if (!state) return null;
  if (state.ok) {
    return successMessage ? (
      <p
        role="status"
        className={cn(
          "rounded-md bg-success-soft p-3 text-sm text-success-soft-foreground",
          className,
        )}
      >
        {successMessage}
      </p>
    ) : null;
  }
  return (
    <p
      role="alert"
      className={cn("rounded-md bg-danger-soft p-3 text-sm text-danger-soft-foreground", className)}
    >
      {state.error.message}
    </p>
  );
}

/** Field-level messages from a failed action, for FormField `errors`. */
export function fieldErrorsFor(
  state: ActionResult<unknown> | null,
  field: string,
): readonly string[] | undefined {
  if (!state || state.ok) return undefined;
  return state.error.fieldErrors?.[field];
}
