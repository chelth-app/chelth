"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";

const ITEMS = [
  { label: "Organisations", href: "/app", exact: true },
  { label: "Security", href: "/app/security", exact: false },
  { label: "Account", href: "/app/account", exact: false },
] as const;

/** Compact account navigation; the current destination is marked (aria-current). */
export function PersonalNav() {
  const pathname = usePathname();
  return (
    <>
      {ITEMS.map((item) => {
        const current = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href as Route}
            aria-current={current ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-[8px] px-3 text-[14px] transition-colors",
              current
                ? "bg-chelth-mint-mist font-semibold text-chelth-teal-dark"
                : "font-medium text-slate-600 hover:bg-surface-muted hover:text-chelth-navy",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
