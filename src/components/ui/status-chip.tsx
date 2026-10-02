import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Semantic status tones (P3 "soft chip + dot"). Colours come from the brand
 * semantic palette (globals.css); the TEXT is always the source of meaning.
 *
 * - neutral   — inactive, draft, not required, closed without issue
 * - info      — in progress, waiting on someone else
 * - success   — done, verified, signed off, filled
 * - warning   — caution, partial, expiring, declined
 * - danger    — failed, blocked, disputed, cancelled with impact
 * - attention — needs an operator's action now
 */
export const statusChipTones = {
  neutral: "bg-neutral-soft text-neutral-soft-foreground before:bg-neutral-indicator",
  info: "bg-info-soft text-info-soft-foreground before:bg-info-indicator",
  success: "bg-success-soft text-success-soft-foreground before:bg-success-indicator",
  warning: "bg-warning-soft text-warning-soft-foreground before:bg-warning-indicator",
  danger: "bg-danger-soft text-danger-soft-foreground before:bg-danger-indicator",
  attention: "bg-attention-soft text-attention-soft-foreground before:bg-attention-indicator",
} as const;

export type StatusTone = keyof typeof statusChipTones;

export type StatusChipProps = HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone };

/**
 * Status label with a decorative leading dot. Never rely on colour alone:
 * pass the full status text ("Expired", "Needs review"), not a code.
 */
export function StatusChip({ tone = "neutral", className, ...props }: StatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        "before:size-1.5 before:shrink-0 before:rounded-full before:content-['']",
        statusChipTones[tone],
        className,
      )}
      {...props}
    />
  );
}
