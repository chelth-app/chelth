import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type ErrorStateProps = {
  title?: string;
  /** Must be a safe, user-facing message (e.g. PublicError.message). */
  message: string;
  /** Optional support reference (e.g. error digest). Never a stack trace. */
  reference?: string | undefined;
  action?: ReactNode;
  className?: string;
};

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
        "flex flex-col items-start gap-3 rounded-lg border border-danger-soft bg-surface p-6",
        className,
      )}
    >
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{message}</p>
      {reference ? (
        <p className="text-xs text-subtle-foreground">
          Reference: <code className="font-mono">{reference}</code>
        </p>
      ) : null}
      {action}
    </div>
  );
}
