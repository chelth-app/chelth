import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import type { WorkspaceNavIcon as IconName } from "@/components/layout/workspace-navigation-model";
import { RefChip } from "@/components/reference/locked-reference";
import {
  RECORD_ROW,
  RECORD_ROW_META,
  RECORD_ROW_TITLE,
  RecordList,
} from "@/components/reference/record-page";
import type { StatusTone } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils/cn";

/*
 * Canonical Settings patterns (P0-E8 Settings lock; docs/ui-reference/
 * CHELTH-LOCKED-VISUAL-SYSTEM.md, "Canonical Settings Implementation").
 * Approved on Settings → Credentials & Compliance; every Settings section
 * reuses these exact values. The card itself is the locked `Panel`.
 * Presentation only — no data, no controls.
 */

/**
 * Icon tile tints. Mint is the default; the other tints are for rows whose
 * meaning is a status (same values as the locked KPI tiles).
 */
const TILE_TONE = {
  teal: "bg-[linear-gradient(145deg,#e6f9f3,#ccefe3)] text-chelth-teal-dark",
  info: "bg-[linear-gradient(145deg,#eaf3fe,#d3e5fc)] text-info-indicator",
  warning: "bg-[linear-gradient(145deg,#fef7ea,#fbe9cc)] text-warning-indicator",
  danger: "bg-[linear-gradient(145deg,#fdeeed,#f8d8d5)] text-danger-indicator",
} as const;

/** 36 px icon tile, 10 px radius, 18 px icon at 2.1 stroke. */
export function SettingsIconTile({
  icon,
  tone = "teal",
}: {
  icon: IconName;
  tone?: keyof typeof TILE_TONE;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] [&>svg]:size-[18px]",
        TILE_TONE[tone],
      )}
    >
      <WorkspaceNavIcon name={icon} strokeWidth={2.1} />
    </span>
  );
}

/** Divided icon-led list (teal hairlines, top and bottom rule). */
export function SettingsExplanationList({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return <RecordList label={label}>{children}</RecordList>;
}

/**
 * Icon-led row: tile, title (15 / 600 ink), one supporting line (13 slate)
 * and optional trailing chips, which wrap under the text on narrow widths.
 */
export function SettingsExplanationRow({
  icon,
  title,
  note,
  tone,
  trailing,
}: {
  icon: IconName;
  title: ReactNode;
  note?: ReactNode;
  tone?: keyof typeof TILE_TONE;
  trailing?: ReactNode;
}) {
  return (
    <li className={RECORD_ROW}>
      <SettingsIconTile icon={icon} tone={tone} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={RECORD_ROW_TITLE}>{title}</span>
        {note ? <span className={RECORD_ROW_META}>{note}</span> : null}
      </span>
      {trailing ? <span className="flex flex-wrap items-center gap-2">{trailing}</span> : null}
    </li>
  );
}

/** A labelled line of compact outcome chips ("Results: Ready · …"). */
export function SettingsStatusSummary({
  label,
  items,
}: {
  label: string;
  items: { tone: StatusTone; label: ReactNode }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13.5px] font-medium text-slate-600">{label}:</span>
      {items.map((item, index) => (
        <RefChip key={index} tone={item.tone} className="font-normal">
          {item.label}
        </RefChip>
      ))}
    </div>
  );
}

/** Row of navigation actions beneath a Settings card's content. */
export function SettingsActionRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2.5">{children}</div>;
}

/**
 * Canonical secondary action as a link (outlined, navy semibold label,
 * optional teal-dark icon). Settings links lead to the real destination; they
 * never stand in for a control that does not exist. `sm` is the compact
 * in-table variant (36 px, 13 px label, 16 px icon).
 */
export function SettingsActionLink({
  href,
  icon,
  size = "md",
  children,
}: {
  href: string;
  icon?: IconName;
  size?: "md" | "sm";
  children: ReactNode;
}) {
  const compact = size === "sm";
  return (
    <Link
      href={href as Route}
      className={cn(
        "inline-flex items-center rounded-[8px] border border-[rgba(0,90,96,0.35)] bg-white font-semibold text-chelth-navy shadow-[0_1px_2px_rgba(13,47,66,0.05)] hover:border-chelth-teal-dark hover:bg-[#f4fbf9]",
        compact
          ? "min-h-9 w-fit gap-1.5 px-3 text-[13px] whitespace-nowrap"
          : "min-h-11 gap-2 px-4 text-[14px]",
      )}
    >
      {icon ? (
        <WorkspaceNavIcon
          name={icon}
          strokeWidth={2.1}
          className={cn("shrink-0 text-chelth-teal-dark", compact ? "size-4" : "size-[18px]")}
        />
      ) : null}
      {children}
    </Link>
  );
}

/**
 * Related areas: navigation-only link cards (icon tile, title, one-line
 * purpose), 1 / 2 / 3 columns. No metrics and no controls.
 */
export function SettingsRelatedLinks({
  label,
  items,
}: {
  label: string;
  items: { icon: IconName; title: string; note: string; href: string }[];
}) {
  return (
    <ul aria-label={label} className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <li key={item.title}>
          <Link
            href={item.href as Route}
            className="flex h-full min-h-14 items-start gap-3 rounded-[10px] border border-[rgba(18,107,103,0.12)] bg-white px-3.5 py-3 transition-colors hover:border-chelth-teal-dark hover:bg-[#f4fbf9]"
          >
            <SettingsIconTile icon={item.icon} />
            <span className="flex min-w-0 flex-col">
              <span className="text-[14.5px] leading-5 font-semibold text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]">
                {item.title}
              </span>
              <span className="text-[12.5px] leading-[18px] text-slate-600">{item.note}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
