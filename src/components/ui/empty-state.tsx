import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import { StateIcon, type StateIconName } from "./state-icon";

type EmptyStateProps = {
  title: string;
  /** One concise sentence explaining why it is empty or what happens next. */
  description?: ReactNode;
  /** At most one recovery / next-step action. */
  action?: ReactNode;
  icon?: StateIconName;
  /** Heading level inside the page outline (default h2; use 3 under a section h2). */
  headingLevel?: 2 | 3;
  className?: string;
};

/** Empty state (P9 system-state language): icon tile, title, one sentence, one action. */
export function EmptyState({
  title,
  description,
  action,
  icon = "empty",
  headingLevel = 2,
  className,
}: EmptyStateProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-surface p-6 sm:flex-row sm:items-center",
        className,
      )}
    >
      <StateIcon name={icon} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Heading className="font-display text-base font-semibold text-chelth-navy">{title}</Heading>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
