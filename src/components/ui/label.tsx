import type { LabelHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean };

export function Label({ required = false, className, children, ...props }: LabelProps) {
  return (
    <label className={cn("text-sm font-medium text-foreground", className)} {...props}>
      {children}
      {/* Visual marker only: the control's native `required` attribute is what
          assistive technology announces, so the label text stays clean. */}
      {required ? (
        <span aria-hidden="true" className="ml-0.5 text-danger">
          *
        </span>
      ) : null}
    </label>
  );
}
