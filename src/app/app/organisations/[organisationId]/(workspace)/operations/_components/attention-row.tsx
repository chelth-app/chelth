import type { ReactNode } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import type { WorkspaceNavIcon as IconName } from "@/components/layout/workspace-navigation-model";
import { cn } from "@/lib/utils/cn";

/*
 * Locked Notifications list language applied to Operations attention items:
 * semantic icon tile, title + explanation, related context, time, status and
 * a row action. Columns: Item · Related to · Time · Status · action.
 */

type Tone = "danger" | "warning" | "info";

const TILE: Record<Tone, string> = {
  danger: "bg-danger-soft text-danger-indicator",
  warning: "bg-warning-soft text-warning-indicator",
  info: "bg-info-soft text-info-indicator",
};

export const ATTENTION_GRID =
  "grid gap-x-4 gap-y-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,200px)_150px_150px_minmax(44px,max-content)] xl:items-center";

/** Semantic icon tile (36 px, 10 px radius), tone from real severity/state. */
export function AttentionIcon({ tone, icon }: { tone: Tone; icon: IconName }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] [&>svg]:size-[19px]",
        TILE[tone],
      )}
    >
      <WorkspaceNavIcon name={icon} strokeWidth={2.1} />
    </span>
  );
}

/** Header band (visual only; each row repeats its labels for assistive tech). */
export function AttentionHeader({ related }: { related: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        ATTENTION_GRID,
        "hidden rounded-md bg-[color-mix(in_srgb,var(--chelth-mint-mist)_45%,#eef4f8)] px-3 py-[7px] text-[11.5px] leading-4 font-semibold text-muted-foreground xl:grid",
      )}
    >
      <span>Item</span>
      <span>{related}</span>
      <span>Time</span>
      <span>Status</span>
      <span />
    </div>
  );
}

export function AttentionRow({
  tone,
  icon,
  title,
  explanation,
  related,
  time,
  status,
  action,
}: {
  tone: Tone;
  icon: IconName;
  title: ReactNode;
  explanation: ReactNode;
  related: ReactNode;
  time: ReactNode;
  status: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li
      className={cn(
        ATTENTION_GRID,
        "px-3 py-3 transition-colors hover:bg-surface-muted/50 has-[dialog[open]]:bg-chelth-mint-mist/70 [&:has(dialog[open])]:shadow-[inset_3px_0_0_var(--chelth-teal)]",
      )}
    >
      <span className="flex min-w-0 items-start gap-3">
        <AttentionIcon tone={tone} icon={icon} />
        <span className="flex min-w-0 flex-col">
          <span className="text-[14px] leading-5 font-semibold text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]">
            {title}
          </span>
          <span className="text-[12.5px] leading-[18px] text-slate-600">{explanation}</span>
        </span>
      </span>
      <span className="min-w-0 pl-12 text-[13px] leading-5 text-slate-600 xl:pl-0">{related}</span>
      <span className="pl-12 text-[12.5px] leading-[18px] text-slate-600 xl:pl-0">{time}</span>
      <span className="flex flex-wrap items-center gap-1.5 pl-12 xl:pl-0">{status}</span>
      <span className="pl-12 xl:pl-0 xl:text-right">{action}</span>
    </li>
  );
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "2 hours ago" from a real timestamp (absolute time stays in <time dateTime>). */
export function relativeTime(iso: string): string {
  const seconds = Math.round((Date.parse(iso) - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(seconds, "second");
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  return relative.format(Math.round(seconds / 86_400), "day");
}
