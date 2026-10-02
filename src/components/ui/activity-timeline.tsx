import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import type { StatusTone } from "./status-chip";

export type ActivityItem = {
  id: string;
  title: ReactNode;
  /** Who and when, e.g. "Ada Admin · 2 Oct 2026, 09:14". */
  meta?: ReactNode;
  /** Optional semantic dot colour; the title still carries the meaning. */
  tone?: StatusTone;
};

const DOT: Record<StatusTone, string> = {
  neutral: "bg-neutral-indicator",
  info: "bg-info-indicator",
  success: "bg-success-indicator",
  warning: "bg-warning-indicator",
  danger: "bg-danger-indicator",
  attention: "bg-attention-indicator",
};

/** Chronological activity / audit history (P3 drawer, P4) as an ordered list. */
export function ActivityTimeline({
  items,
  label,
  className,
}: {
  items: readonly ActivityItem[];
  /** Accessible name of the list, e.g. "Recent activity". */
  label: string;
  className?: string;
}) {
  return (
    <ol aria-label={label} className={cn("flex flex-col", className)}>
      {items.map((item, index) => (
        <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
          {index < items.length - 1 ? (
            <span
              aria-hidden="true"
              className="absolute top-4 bottom-0 left-[5px] w-px bg-border"
            />
          ) : null}
          <span
            aria-hidden="true"
            className={cn(
              "relative mt-1.5 size-[11px] shrink-0 rounded-full ring-2 ring-surface",
              DOT[item.tone ?? "neutral"],
            )}
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{item.title}</span>
            {item.meta ? <span className="text-xs text-muted-foreground">{item.meta}</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
