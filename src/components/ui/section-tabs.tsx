import type { Route } from "next";
import Link from "next/link";

import { cn } from "@/lib/utils/cn";

export type SectionTab = {
  label: string;
  href: Route;
  current: boolean;
  /** Optional real count shown after the label. */
  count?: number;
};

/**
 * Section / page tabs that NAVIGATE (each tab is a URL). Rendered as a
 * labelled nav of links with `aria-current="page"` — deliberately not ARIA
 * tabs, which are for in-place panels. Scrolls horizontally on phones
 * without widening the page.
 *
 * Scroll chrome (P0-E8-A1.2): `overflow-x: auto` makes overflow-y compute to
 * auto too, and the tabs' -1 px bottom margin (overlapping the divider) made
 * the content 1 px taller than the row — a stray vertical scrollbar at the
 * right edge where scrollbars are always shown. overflow-y is now hidden and
 * the scrollbar is visually hidden; touch, trackpad, wheel and keyboard
 * scrolling still work. Focus rings are drawn inside each tab (the approved
 * Finance treatment) so the row never clips them.
 */
export function SectionTabs({
  label,
  tabs,
  className,
}: {
  label: string;
  tabs: readonly SectionTab[];
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "relative [scrollbar-width:none] overflow-x-auto overflow-y-hidden border-b border-border in-[.chelth-locked]:border-[rgba(18,107,103,0.14)] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      <ul className="flex min-w-max gap-1">
        {tabs.map((tab) => (
          <li key={tab.href}>
            <Link
              href={tab.href}
              aria-current={tab.current ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex min-h-11 items-center gap-2 rounded-t-[6px] border-b-2 px-3 text-sm font-medium focus-visible:outline-offset-[-3px]",
                // Locked tab treatment (C/D): 14.5 px, ink active label, 3 px underline.
                "in-[.chelth-locked]:border-b-[3px] in-[.chelth-locked]:text-[14.5px]",
                tab.current
                  ? "border-primary font-semibold text-chelth-navy"
                  : "border-transparent text-muted-foreground hover:border-chelth-border-strong hover:text-foreground in-[.chelth-locked]:text-slate-500 in-[.chelth-locked]:hover:text-chelth-navy",
              )}
            >
              {tab.label}
              {tab.count !== undefined ? (
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-foreground tabular-nums">
                  {tab.count}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
