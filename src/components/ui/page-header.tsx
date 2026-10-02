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
  className,
}: PageHeaderProps) {
  const hasActions = Boolean(primaryAction || secondaryActions);
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      {back ? <div className="text-sm">{back}</div> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1
            id={titleId}
            className="font-display text-[1.75rem] leading-9 font-semibold tracking-[-0.03em] text-chelth-navy sm:text-[2rem] sm:leading-10"
          >
            {title}
          </h1>
          {description ? (
            <div className="max-w-3xl text-base text-muted-foreground">{description}</div>
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
