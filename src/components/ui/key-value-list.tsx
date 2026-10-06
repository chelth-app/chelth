import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export type KeyValueItem = { label: string; value: ReactNode };

/**
 * Label / value pairs (P3 drawer summary, P4 record cards) as a semantic
 * description list. Stacks on phones, two columns from `sm`.
 */
export function KeyValueList({
  items,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLDListElement>, "children"> & {
  items: readonly KeyValueItem[];
}) {
  return (
    <dl
      {...props}
      className={cn(
        "grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr] sm:gap-y-2.5",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="pt-1.5 text-muted-foreground in-[.chelth-locked]:font-medium in-[.chelth-locked]:text-slate-600 sm:pt-0">
            {item.label}
          </dt>
          <dd className="min-w-0 break-words text-foreground in-[.chelth-locked]:font-medium in-[.chelth-locked]:text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
