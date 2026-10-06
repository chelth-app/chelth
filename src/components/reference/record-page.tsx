import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/*
 * Canonical record-page primitives (docs/ui-reference/CHELTH-LOCKED-VISUAL-
 * SYSTEM.md, "Canonical Record Page Primitives"). Shared by Worker Record and
 * Facility Record; every future record page inherits these exact values.
 * Presentation only.
 */

/** Page wrapper: the locked scope and the 20 px section rhythm. */
export function RecordPage({ children }: { children: ReactNode }) {
  return <div className="chelth-locked flex flex-col gap-5">{children}</div>;
}

/** Secondary header metadata beside the status chip (14 px, slate, medium). */
export function RecordMeta({ children }: { children: ReactNode }) {
  return <span className="text-[14px] leading-5 font-medium text-slate-600">{children}</span>;
}

/** Supporting copy inside a panel (14 px, slate, medium). */
export function RecordNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-[14px] leading-5 font-medium text-slate-600", className)}>{children}</p>
  );
}

/** Divided record list: teal hairline dividers, top and bottom rule. */
export function RecordList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul
      aria-label={label}
      className="flex flex-col divide-y divide-[rgba(18,107,103,0.12)] border-y border-[rgba(18,107,103,0.12)] text-sm"
    >
      {children}
    </ul>
  );
}

/** Record list row: 56 px minimum, 12 px gap, the canonical row padding. */
export const RECORD_ROW = "flex min-h-14 flex-wrap items-center gap-3 px-1 py-2.5";

/** Primary text in a record row (15 px / 600 ink). */
export const RECORD_ROW_TITLE =
  "text-[15px] leading-5 font-semibold text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]";

/** Secondary text in a record row (13 px slate). */
export const RECORD_ROW_META = "text-[13px] leading-[18px] text-slate-600";

/** Status block: the record's anchored state (soft mint surface, hairline border). */
export function RecordStatusBlock({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[rgba(18,107,103,0.10)] bg-[linear-gradient(180deg,#f6fbfa,#eef7f4)] px-4 py-3">
      {children}
    </div>
  );
}
