import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import type { StatusTone } from "./status-chip";

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
  /**
   * `compact` (default): value-first card. `reference`: the locked P2/P3 KPI
   * tile — large tinted icon tile, label above value, supporting line and a
   * "View … →" line (Operations Overview, Shifts).
   */
  variant?: "compact" | "reference";
  /** Icon-tile tint for the reference variant (decorative; the label carries meaning). */
  tone?: "teal" | StatusTone;
  /** Reference variant: the visible "View … →" line (the whole card is the link). */
  actionLabel?: string;
  /**
   * Reference variant geometry, measured from the locked PNGs:
   * `lg` (P2 Operations Overview): 62 px tile, 129 px card, text column at 99 px;
   * `md` (P3 Shifts): 50 px tile, 122 px card, text column at 86 px.
   */
  size?: "lg" | "md";
  className?: string;
};

const TILE_TONE: Record<"teal" | StatusTone, string> = {
  teal: "bg-chelth-mint-mist text-chelth-teal-dark",
  neutral: "bg-neutral-soft text-neutral-soft-foreground",
  info: "bg-info-soft text-info-indicator",
  success: "bg-success-soft text-success-indicator",
  warning: "bg-warning-soft text-warning-indicator",
  danger: "bg-danger-soft text-danger-indicator",
  attention: "bg-attention-soft text-attention-indicator",
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
  variant = "compact",
  tone = "teal",
  actionLabel,
  size = "lg",
  className,
}: KpiFilterCardProps) {
  if (variant === "reference") {
    const lg = size === "lg";
    const referenceBody = (
      <>
        {icon ? (
          <span
            aria-hidden="true"
            className={cn(
              "hidden shrink-0 items-center justify-center rounded-[10px] sm:inline-flex",
              lg ? "size-[62px] [&>svg]:size-[30px]" : "size-[50px] [&>svg]:size-6",
              TILE_TONE[tone],
            )}
          >
            {icon}
          </span>
        ) : null}
        <span className={cn("flex min-w-0 flex-col", lg && "sm:mt-2.5")}>
          <span className="text-sm leading-5 font-medium text-foreground">{label}</span>
          <span className="font-display text-[1.625rem] leading-[1.875rem] font-semibold text-chelth-navy tabular-nums">
            {value}
          </span>
          {supporting ? (
            <span className="text-[13px] leading-5 text-muted-foreground">{supporting}</span>
          ) : null}
          {actionLabel ? (
            <span className="mt-[5px] text-[13px] leading-5 font-medium text-primary">
              {actionLabel} <span aria-hidden="true">→</span>
            </span>
          ) : null}
          {active ? <span className="mt-1 text-xs font-semibold text-primary">Showing</span> : null}
        </span>
      </>
    );
    const referenceClasses = cn(
      "flex min-h-11 min-w-0 items-start rounded-[10px] border bg-surface p-3 break-words shadow-card",
      lg
        ? "sm:gap-[25px] sm:pt-[11px] sm:pb-[13px] xl:min-h-[129px]"
        : "sm:gap-6 sm:pb-[15px] xl:min-h-[122px]",
      active ? "border-primary ring-1 ring-primary" : "border-border",
      href && "transition-colors hover:border-primary/60",
      className,
    );
    if (!href) return <div className={referenceClasses}>{referenceBody}</div>;
    return (
      <Link href={href} aria-current={active ? "true" : undefined} className={referenceClasses}>
        {referenceBody}
      </Link>
    );
  }
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
