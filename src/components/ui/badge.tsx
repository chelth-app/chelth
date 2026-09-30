import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export const badgeTones = {
  neutral: "bg-surface-muted text-muted-foreground",
  brand: "bg-accent-soft text-accent-soft-foreground",
  info: "bg-info-soft text-info-soft-foreground",
  success: "bg-success-soft text-success-soft-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground",
  danger: "bg-danger-soft text-danger-soft-foreground",
} as const;

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof badgeTones };

/**
 * Status label. Never rely on colour alone: the text must carry the meaning
 * (e.g. "Expired", not just a red dot).
 */
export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium",
        badgeTones[tone],
        className,
      )}
      {...props}
    />
  );
}
