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

/**
 * Error state (P9, locked system): a compact semantic notice for use inside a
 * card or page — coral hairline and tint, error tile, title, the safe message,
 * an optional support reference and one recovery action. Announced as an
 * alert; the text carries the meaning, not the colour.
 */
export function ErrorState({
  title = "This could not be completed",
  message,
  reference,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-3 rounded-[12px] border border-[rgba(229,72,77,0.16)] bg-danger-soft/40 p-4 sm:flex-row",
        className,
      )}
    >
      <StateIcon name="error" />
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        <h2 className="font-display text-[17px] leading-6 font-semibold text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]">
          {title}
        </h2>
        <p className="text-sm text-slate-700">{message}</p>
        {reference ? (
          <p className="text-xs text-slate-600">
            Reference: <code className="font-mono">{reference}</code>
          </p>
        ) : null}
        {action ? <div className="pt-1.5">{action}</div> : null}
      </div>
    </div>
  );
}
