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
  /**
   * `reference`: locked P2 dashboard panel (Operations Overview) — 10 px
   * insets, title at 15 px, a 33 px header row, 9 px to the content.
   */
  variant?: "default" | "reference";
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
  variant = "default",
  className,
}: PanelProps) {
  const reference = variant === "reference";
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn(
        "flex min-w-0 scroll-mt-24 flex-col rounded-lg border border-border bg-surface shadow-card",
        reference ? "gap-[9px] rounded-[10px] px-2.5 pt-2 pb-2.5" : "gap-4 p-4 sm:p-5",
        // Locked Chelth surface (docs/ui-reference/CHELTH-LOCKED-VISUAL-SYSTEM.md, F):
        // inherited by every page inside `.chelth-locked`.
        !reference &&
          "in-[.chelth-locked]:rounded-xl in-[.chelth-locked]:border-[rgba(18,107,103,0.10)] in-[.chelth-locked]:bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(247,252,252,0.92))] in-[.chelth-locked]:shadow-[0_10px_30px_rgba(13,47,66,0.07),0_1px_2px_rgba(13,47,66,0.05)] in-[.chelth-locked]:backdrop-blur-[10px] in-[.chelth-locked]:sm:gap-[18px]",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-wrap justify-between gap-3",
          reference ? "min-h-[33px] items-center pr-0.5 pl-[5px]" : "items-start",
        )}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <Heading
            id={titleId}
            className="font-display text-lg leading-[26px] font-semibold text-chelth-navy in-[.chelth-locked]:text-[20px] in-[.chelth-locked]:font-extrabold in-[.chelth-locked]:tracking-[-0.02em] in-[.chelth-locked]:text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]"
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
  size = "md",
  className,
}: {
  href: Route;
  children: ReactNode;
  /** `sm`: the locked P2 "View All →" button (33 px desktop, 44 px touch). */
  size?: "md" | "sm";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-md border border-input-border bg-surface px-3 text-sm font-medium text-primary hover:bg-surface-muted",
        size === "sm" && "border-border sm:min-h-[33px] sm:text-[13px]",
        className,
      )}
    >
      {children}
      <span aria-hidden="true">→</span>
    </Link>
  );
}
