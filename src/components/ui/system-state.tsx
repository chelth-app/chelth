import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import { StateIcon, type StateIconName } from "./state-icon";

type SystemStateProps = {
  title: string;
  /** One concise, safe explanation (never implementation details). */
  description?: ReactNode;
  /** Support reference (e.g. error digest). Never a stack trace. */
  reference?: string | undefined;
  /** One clear recovery action (optionally a second, outlined one). */
  action?: ReactNode;
  icon?: StateIconName;
  /** Errors announce themselves (role="alert"); not-found does not. */
  tone?: "neutral" | "error";
  /** 1 when the state replaces the page (default); 2 for reference/embedded use. */
  headingLevel?: 1 | 2;
  className?: string;
};

/**
 * Locked card surface shared by system states and auth panels: 14 px radius,
 * teal hairline, white → cool-mint surface, the canonical two-layer navy
 * shadow. No glass, glow or illustration.
 */
export const SYSTEM_CARD =
  "rounded-[14px] border border-[rgba(18,107,103,0.10)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,252,252,0.95))] shadow-[0_10px_30px_rgba(13,47,66,0.07),0_1px_2px_rgba(13,47,66,0.05)]";

/** Heading ink (locked typography). */
const INK = "text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]";

/**
 * Full-page system state (P9, locked system): luminous icon tile, the page's
 * h1, one sentence, an optional support reference and the recovery action(s).
 * Rendered inside whichever frame owns the route (workspace shell, worker
 * shell, personal frame or auth canvas). `.chelth-locked` gives buttons the
 * locked treatment.
 */
export function SystemState({
  title,
  description,
  reference,
  action,
  icon = "search",
  tone = "neutral",
  headingLevel = 1,
  className,
}: SystemStateProps) {
  const Heading = headingLevel === 2 ? "h2" : "h1";
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "chelth-locked mx-auto flex w-full max-w-md flex-col items-center gap-4 px-6 py-8 text-center sm:px-8",
        SYSTEM_CARD,
        className,
      )}
    >
      <StateIcon name={tone === "error" ? "error" : icon} variant="luminous" />
      <div className="flex flex-col gap-2">
        <Heading
          className={cn("font-display text-[24px] leading-8 font-bold tracking-[-0.02em]", INK)}
        >
          {title}
        </Heading>
        {description ? (
          <p className="text-[14.5px] leading-[22px] text-slate-600">{description}</p>
        ) : null}
      </div>
      {reference ? (
        <p className="rounded-md bg-surface-muted px-2.5 py-1 text-xs text-slate-600">
          Reference: <code className="font-mono">{reference}</code>
        </p>
      ) : null}
      {action ? (
        <div className="flex w-full flex-col justify-center gap-2.5 pt-1 sm:w-auto sm:flex-row">
          {action}
        </div>
      ) : null}
    </div>
  );
}

/** A link styled as the primary recovery action (locked gradient primary, 44 px). */
export const stateActionClass =
  "inline-flex min-h-11 items-center justify-center rounded-[8px] bg-[linear-gradient(180deg,#00666c,#004f55)] px-5 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_14px_-4px_rgba(0,58,64,0.45)] transition-[filter] hover:brightness-110";

/** A link styled as the secondary recovery action (locked outlined secondary, 44 px). */
export const stateSecondaryActionClass =
  "inline-flex min-h-11 items-center justify-center rounded-[8px] border border-[rgba(0,90,96,0.35)] bg-white px-5 text-sm font-semibold text-chelth-navy shadow-[0_1px_2px_rgba(13,47,66,0.05)] hover:border-chelth-teal-dark hover:bg-[#f4fbf9]";
