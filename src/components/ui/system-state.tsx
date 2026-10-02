import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import { StateIcon, type StateIconName } from "./state-icon";

type SystemStateProps = {
  title: string;
  /** One concise, safe explanation (never implementation details). */
  description?: ReactNode;
  /** Support reference (e.g. error digest). Never a stack trace. */
  reference?: string | undefined;
  /** One clear recovery action. */
  action?: ReactNode;
  icon?: StateIconName;
  /** Errors announce themselves (role="alert"); not-found does not. */
  tone?: "neutral" | "error";
  /** 1 when the state replaces the page (default); 2 for reference/embedded use. */
  headingLevel?: 1 | 2;
  className?: string;
};

/**
 * Full-page system state (P9): icon tile, the page's h1, one sentence, one
 * recovery action. Rendered inside whichever frame owns the route (workspace
 * shell, worker shell, personal frame or auth canvas).
 */
export function SystemState({
  title,
  description,
  reference,
  action,
  icon = "search",
  tone = "neutral",
  headingLevel = 1,
  className,
}: SystemStateProps) {
  const Heading = headingLevel === 2 ? "h2" : "h1";
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-lg border border-border bg-surface p-6 text-center shadow-card sm:p-8",
        className,
      )}
    >
      <StateIcon name={tone === "error" ? "error" : icon} />
      <Heading className="font-display text-2xl leading-8 font-semibold text-chelth-navy">
        {title}
      </Heading>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      {reference ? (
        <p className="text-xs text-subtle-foreground">
          Reference: <code className="font-mono">{reference}</code>
        </p>
      ) : null}
      {action ? <div className="flex flex-wrap justify-center gap-2 pt-1">{action}</div> : null}
    </div>
  );
}

/** A link styled as the primary recovery action (44 px). */
export const stateActionClass =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover";
