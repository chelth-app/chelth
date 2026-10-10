import type { Route } from "next";
import Link from "next/link";

import { cn } from "@/lib/utils/cn";

/** The canonical Today / Upcoming / Past segmented control (links; server truth). */
export function PeriodTabs({
  base,
  current,
}: {
  base: string;
  current: "today" | "upcoming" | "past";
}) {
  const tabs = [
    { key: "today", label: "Today", href: base },
    { key: "upcoming", label: "Upcoming", href: `${base}?view=upcoming` },
    { key: "past", label: "Past", href: `${base}?view=past` },
  ] as const;
  return (
    <nav aria-label="Shift period">
      <ul className="grid grid-cols-3 gap-1 rounded-[12px] border border-[rgba(18,107,103,0.12)] bg-white p-1 shadow-[0_1px_2px_rgba(13,47,66,0.04)]">
        {tabs.map((tab) => {
          const active = tab.key === current;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href as Route}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center justify-center rounded-[9px] text-[14px] font-medium",
                  active
                    ? "bg-[linear-gradient(180deg,#e9f7f3,#dcf2ec)] font-semibold text-chelth-teal-dark shadow-[inset_0_0_0_1px_rgba(18,107,103,0.18)]"
                    : "text-slate-600 hover:text-chelth-navy",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
