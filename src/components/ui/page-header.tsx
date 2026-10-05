import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type PageHeaderProps = {
  title: ReactNode;
  /** One short supporting sentence or paragraph under the title. */
  description?: ReactNode;
  /** Breadcrumb or back link, rendered above the title. */
  back?: ReactNode;
  /** Status chips or metadata rendered under the title. */
  meta?: ReactNode;
  /** Primary page action (top right on wide screens). */
  primaryAction?: ReactNode;
  /** Secondary actions, only when genuinely needed. */
  secondaryActions?: ReactNode;
  titleId?: string;
  /** `reference`: locked P2/P3 header — description sits directly under the title. */
  variant?: "default" | "reference";
  className?: string;
};

/**
 * Page title block (P1/P3) following docs/brand/CHELTH-PRODUCT-TYPOGRAPHY.md:
 * Manrope 600, 32/40, -0.03em on wide screens (one step smaller on phones);
 * supporting copy Inter 16/24. Compact — not a hero.
 */
export function PageHeader({
  title,
  description,
  back,
  meta,
  primaryAction,
  secondaryActions,
  titleId,
  variant = "default",
  className,
}: PageHeaderProps) {
  const hasActions = Boolean(primaryAction || secondaryActions);
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      {back ? <div className="text-sm">{back}</div> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className={cn("flex min-w-0 flex-col", variant === "reference" ? "gap-0" : "gap-1.5")}>
          <h1
            id={titleId}
            className={cn(
              "font-display text-[1.75rem] leading-9 font-semibold tracking-[-0.03em] text-chelth-navy sm:text-[2rem] sm:leading-10",
              // Locked P2/P3 rendering, calibrated against the approved PNG ink.
              variant === "reference" &&
                "font-extrabold tracking-normal text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)] [-webkit-text-stroke:0.4px_currentColor] sm:text-[31.5px] sm:leading-[38px]",
            )}
          >
            {title}
          </h1>
          {description ? (
            <div
              className={cn(
                "text-base text-muted-foreground",
                variant === "reference" ? "sm:text-[17.5px] sm:leading-[26px]" : "max-w-3xl",
              )}
            >
              {description}
            </div>
          ) : null}
          {meta ? <div className="flex flex-wrap items-center gap-2 pt-1">{meta}</div> : null}
        </div>
        {hasActions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {secondaryActions}
            {primaryAction}
          </div>
        ) : null}
      </div>
    </header>
  );
}
