import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type PanelProps = {
  title: ReactNode;
  /** Id of the heading; the panel is a region labelled by it. */
  titleId: string;
  description?: ReactNode;
  /** One header action, typically a `PanelLink` ("View all") or a small button. */
  action?: ReactNode;
  children?: ReactNode;
  headingLevel?: 2 | 3;
  /** Anchor id for in-page links (e.g. KPI cards that jump to this panel). */
  id?: string;
  className?: string;
};

/**
 * Titled card (P2 dashboard panel, P4 record card): heading, optional one-line
 * description and one header action, then content.
 */
export function Panel({
  title,
  titleId,
  description,
  action,
  children,
  headingLevel = 2,
  id,
  className,
}: PanelProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn(
        "flex min-w-0 scroll-mt-24 flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Heading
            id={titleId}
            className="font-display text-lg leading-[26px] font-semibold text-chelth-navy"
          >
            {title}
          </Heading>
          {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Outline "View all" style link used in panel headers. */
export function PanelLink({
  href,
  children,
  className,
}: {
  href: Route;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-md border border-input-border bg-surface px-3 text-sm font-medium text-primary hover:bg-surface-muted",
        className,
      )}
    >
      {children}
      <span aria-hidden="true">→</span>
    </Link>
  );
}
