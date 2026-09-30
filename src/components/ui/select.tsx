import type { SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

/** Native select: fully keyboard and screen-reader accessible on every platform. */
export function Select({ invalid = false, className, children, ...props }: SelectProps) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn(
        "h-11 w-full rounded-md border border-input-border bg-surface px-3 text-base text-foreground",
        "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70",
        "aria-invalid:border-danger",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
