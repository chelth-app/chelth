import type { TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export function Textarea({ invalid = false, className, ...props }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full rounded-md border border-input-border bg-surface px-3 py-2 text-base text-foreground",
        "placeholder:text-subtle-foreground disabled:cursor-not-allowed disabled:bg-surface-muted",
        "aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}
