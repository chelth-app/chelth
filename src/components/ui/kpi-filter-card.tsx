import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type KpiFilterCardProps = {
  label: string;
  value: ReactNode;
  /** Optional supporting count or state, e.g. "2 urgent". */
  supporting?: ReactNode;
  /** Decorative icon shown in a tile; the label carries the meaning. */
  icon?: ReactNode;
  /** Link target (a filtered view or an in-page section). Omit for a static figure. */
  href?: Route;
  /** The view this card filters to is the one shown. */
  active?: boolean;
  className?: string;
};

/**
 * Compact KPI / quick-filter card (P2/P3). Shows only real counts the page
 * already has: no charts, sparklines or trend deltas.
 *
 * As a link it is a filter shortcut; the active card carries
 * `aria-current="true"`, a heavier border and a visible "Showing" marker, so
 * the state is never conveyed by colour alone.
 */
export function KpiFilterCard({
  label,
  value,
  supporting,
  icon,
  href,
  active = false,
  className,
}: KpiFilterCardProps) {
  const body = (
    <>
      {icon ? (
        <span
          aria-hidden="true"
          className="hidden size-10 shrink-0 items-center justify-center rounded-md bg-chelth-mint-mist text-chelth-teal-dark sm:inline-flex"
        >
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-col">
        <span className="font-display text-[1.375rem] leading-7 font-semibold text-chelth-navy tabular-nums sm:text-[1.625rem] sm:leading-[1.875rem]">
          {value}
        </span>
        <span className="text-sm font-medium text-foreground">{label}</span>
        {supporting ? <span className="text-xs text-muted-foreground">{supporting}</span> : null}
        {active ? <span className="mt-1 text-xs font-semibold text-primary">Showing</span> : null}
      </span>
    </>
  );
  const classes = cn(
    "flex min-h-11 min-w-0 items-start gap-3 rounded-lg border bg-surface p-3 break-words shadow-card sm:p-4",
    active ? "border-2 border-primary p-[11px] sm:p-[15px]" : "border-border",
    href && "transition-colors hover:border-primary/60 hover:bg-surface-muted/50",
    className,
  );
  if (!href) return <div className={classes}>{body}</div>;
  return (
    <Link href={href} aria-current={active ? "true" : undefined} className={classes}>
      {body}
    </Link>
  );
}

/**
 * Responsive row of KPI cards: 2 compact columns on phones (icon tile hidden,
 * tighter padding), 2 on tablets, 4 from xl.
 */
export function KpiFilterGroup({
  label,
  children,
  className,
}: {
  /** Accessible name of the group, e.g. "Attendance summary". */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={label} className={cn("grid grid-cols-2 gap-3 xl:grid-cols-4", className)}>
      {children}
    </section>
  );
}
