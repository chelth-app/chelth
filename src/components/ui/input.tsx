import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export function Input({ invalid = false, className, type = "text", ...props }: InputProps) {
  return (
    <input
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        // text-base (16px) prevents iOS Safari zooming into focused inputs.
        "h-11 w-full rounded-md border border-input-border bg-surface px-3 text-base text-foreground",
        "placeholder:text-subtle-foreground",
        "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70",
        "aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}
