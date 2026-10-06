"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import type { WorkspaceNavIcon as IconName } from "@/components/layout/workspace-navigation-model";
import { cn } from "@/lib/utils/cn";

/**
 * Locked Settings sub-navigation (reference left column): icon + label rows,
 * the current section with a mint fill, a teal left rule and a restrained navy
 * hairline — deliberately quieter than the primary sidebar's selected item. A
 * labelled nav of links (each section is a URL), current marked with
 * aria-current="page". Below lg it is one horizontally scrolling row (no second
 * mobile pattern) that opens scrolled to the current section. On desktop it
 * sticks 16 px below the 76 px sticky top bar.
 */
export function SettingsNav({
  items,
}: {
  items: { label: string; href: string; icon: IconName; exact: boolean }[];
}) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);

  // Phones / tablets: bring the current section into the scrolled row. Only the
  // nav's own scroll position changes — never the page's.
  useEffect(() => {
    const nav = navRef.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    const left =
      current.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft;
    if (left < nav.scrollLeft || left + current.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = Math.max(0, left - 8);
    }
  }, [pathname]);

  return (
    <nav
      ref={navRef}
      aria-label="Settings sections"
      className="min-w-0 overflow-x-auto rounded-xl border border-[rgba(18,107,103,0.10)] bg-white/90 p-2 shadow-[0_2px_10px_rgba(21,45,49,0.05)] lg:sticky lg:top-[92px] lg:overflow-visible lg:p-2.5"
    >
      <ul className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col">
        {items.map((item) => {
          const current = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href as Route}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3.5 rounded-[8px] border border-l-[3px] px-3 text-[14.5px] whitespace-nowrap transition-colors lg:min-h-[46px] lg:px-4",
                  current
                    ? "border-[rgba(12,30,70,0.09)] border-l-chelth-teal bg-chelth-mint-mist/80 font-semibold text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]"
                    : "border-transparent font-medium text-slate-600 hover:bg-surface-muted hover:text-chelth-navy",
                )}
              >
                {/* Same icon family as the main sidebar (22 px there); here 21 px with a
                    firmer stroke and full-strength ink on the light surface, so it reads with
                    the same confidence while staying subordinate. */}
                <span aria-hidden="true" className="flex w-[22px] shrink-0 justify-center">
                  <WorkspaceNavIcon
                    name={item.icon}
                    strokeWidth={1.9}
                    className={cn(
                      "size-[21px]",
                      current ? "text-chelth-teal-dark" : "text-chelth-navy/80",
                    )}
                  />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
