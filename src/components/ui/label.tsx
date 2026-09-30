import type { LabelHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean };

export function Label({ required = false, className, children, ...props }: LabelProps) {
  return (
    <label className={cn("text-sm font-medium text-foreground", className)} {...props}>
      {children}
      {required ? (
        <>
          <span aria-hidden="true" className="ml-0.5 text-danger">
            *
          </span>
          <span className="sr-only"> (required)</span>
        </>
      ) : null}
    </label>
  );
}
