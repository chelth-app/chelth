import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import { StateIcon } from "./state-icon";

type ErrorStateProps = {
  title?: string;
  /** Must be a safe, user-facing message (e.g. PublicError.message). */
  message: string;
  /** Optional support reference (e.g. error digest). Never a stack trace. */
  reference?: string | undefined;
  action?: ReactNode;
  className?: string;
};

/** Error state (P9): icon tile, title, the safe message, support reference, one recovery action. */
export function ErrorState({
  title = "Something went wrong",
  message,
  reference,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-4 rounded-lg border border-border bg-surface p-6 shadow-card sm:flex-row",
        className,
      )}
    >
      <StateIcon name="error" />
      <div className="flex min-w-0 flex-col items-start gap-2">
        <h2 className="font-display text-lg font-semibold text-chelth-navy">{title}</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
        {reference ? (
          <p className="text-xs text-subtle-foreground">
            Reference: <code className="font-mono">{reference}</code>
          </p>
        ) : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  );
}
