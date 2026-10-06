import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import type { StatusTone } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils/cn";

/*
 * Locked-reference presentation (P0-E8-S9A.3) for the four approved screens:
 * the workspace shell, Operations Overview, Shifts and Shift Details.
 *
 * The approved PNGs (docs/ui-reference/p08-e8/canonical) are the render
 * target. Every size below was calibrated against their rendered ink (width,
 * cap height and stroke) with the self-hosted Inter / Manrope variable fonts,
 * at the Overview canvas scale (1 reference px = 1 CSS px). These blocks hold
 * presentation only — data, permissions and behaviour stay with the pages.
 */

/** Calibrated text styles (reference rendered ink → font size / weight / tracking). */
export const REF_TEXT = {
  /** Page title: Manrope 31.5 / 700 (canonical typography scale). */
  pageTitle: "font-display text-[31.5px] leading-[38px] font-bold text-chelth-navy",
  /** Subtitle: 434 px wide line → Inter 18 / 400. */
  pageSubtitle: "text-[18px] leading-[26px] text-muted-foreground",
  /** Panel titles: Manrope 20 / 600, −0.02em, heading navy. */
  panelTitle:
    "font-display text-[20px] leading-[26px] font-semibold tracking-[-0.02em] text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]",
  /** KPI label: Inter 14.75 / 600, −0.01em. */
  kpiLabel: "text-[14.75px] leading-5 font-semibold tracking-[-0.01em] text-chelth-navy",
  /** KPI value: Manrope 30.5 / 700, −0.01em, heading navy (reference stroke 6.4). */
  kpiValue:
    "font-display text-[30.5px] leading-[34px] font-bold tracking-[-0.01em] text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]",
  /** Shifts KPI (P3, 1/0.87 of its canvas): label Inter 13.5 / 600, value Manrope 31 / 700. */
  kpiLabelMd: "text-[13.5px] leading-[18px] font-semibold tracking-[-0.01em] text-chelth-navy",
  kpiValueMd: "font-display text-[31px] leading-[34px] font-bold text-chelth-navy",
  /** KPI supporting copy: Inter 12.75 / 400. */
  kpiSupporting: "text-[12.75px] leading-[18px] text-muted-foreground",
  /** Table header: Inter 11.5 / 600 on the tinted band. */
  tableHead: "text-[11.5px] leading-4 font-semibold text-muted-foreground",
  /** Table body: Inter 11.5 / 400. */
  tableBody: "text-[11.5px] leading-4 text-slate-600",
  /** Small outlined panel action: Inter 13 / 400. */
  action: "text-[13px] leading-[18px]",
  /** Legend and bar-list rows: Inter 14 / 400. */
  legend: "text-[14px] leading-5 tracking-[-0.01em] text-slate-600",
} as const;

/** Reference card surface: white, hairline border, soft shadow, 12 px radius. */
export const REF_CARD =
  "rounded-xl border border-chelth-border/55 bg-surface shadow-[0_2px_10px_rgba(21,45,49,0.05)]";

/**
 * Operations Overview surface (approved reference): near-white with a light
 * frost, a faint teal hairline and a soft navy ambient shadow. Overview only —
 * restrained depth, not glassmorphism (no translucent rows, fields or chips).
 */
export const REF_CARD_FROSTED =
  "rounded-xl border border-[rgba(18,107,103,0.10)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(247,252,252,0.9))] backdrop-blur-[10px] shadow-[0_10px_30px_rgba(13,47,66,0.07),0_1px_2px_rgba(13,47,66,0.05)]";

/** Panel: card with the reference insets (title at 15 px, header 33 px). */
export function RefPanel({
  title,
  titleId,
  action,
  children,
  className,
}: {
  title: ReactNode;
  titleId: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={titleId}
      className={cn(REF_CARD_FROSTED, "flex min-w-0 flex-col px-2.5 pt-2 pb-2.5", className)}
    >
      <div className="flex min-h-[33px] items-center justify-between gap-3 pr-0.5 pl-[5px]">
        {/* Locked P2: the title sits 2.5 px above the action's centre line. */}
        <h2 id={titleId} className={cn(REF_TEXT.panelTitle, "relative -top-[3px]")}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Outlined "View … →" panel action (33 px on desktop, 44 px touch). */
export function RefPanelAction({ href, children }: { href: Route; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        REF_TEXT.action,
        "inline-flex min-h-11 items-center gap-2 rounded-md border border-chelth-border/80 bg-surface px-3 text-primary hover:bg-surface-muted sm:min-h-[33px]",
      )}
    >
      {children}
      <span aria-hidden="true">→</span>
    </Link>
  );
}

/** Tinted header band + hairline rows (reference panel tables). */
export const REF_TABLE = cn(
  "w-full border-separate border-spacing-0 text-left",
  "[&_th]:bg-[color-mix(in_srgb,var(--chelth-mint-mist)_45%,#eef4f8)] [&_th]:px-3 [&_th]:py-[7px] [&_th]:font-semibold",
  "[&_th:first-child]:rounded-l-md [&_th:last-child]:rounded-r-md",
  "[&_td]:border-b [&_td]:border-chelth-border/45 [&_td]:pr-1 [&_td]:pl-3",
  "[&_tr:last-child_td]:border-b-0",
);

/** Status pill with a filled glyph (reference chip: 30 px tall, 8 px radius). */
const CHIP_TONE: Record<StatusTone, { chip: string; glyph: string }> = {
  success: {
    chip: "bg-success-soft text-success-soft-foreground",
    glyph: "text-success-indicator",
  },
  info: { chip: "bg-info-soft text-info-soft-foreground", glyph: "text-info-indicator" },
  warning: {
    chip: "bg-warning-soft text-warning-soft-foreground",
    glyph: "text-warning-indicator",
  },
  attention: {
    chip: "bg-attention-soft text-attention-soft-foreground",
    glyph: "text-attention-indicator",
  },
  danger: { chip: "bg-danger-soft text-danger-soft-foreground", glyph: "text-danger-indicator" },
  neutral: {
    chip: "bg-neutral-soft text-neutral-soft-foreground",
    glyph: "text-neutral-indicator",
  },
};

function ChipGlyph({ tone }: { tone: StatusTone }) {
  // Decorative: the chip text carries the meaning.
  const mark =
    tone === "success" ? (
      <path d="M4.2 8.3 6.9 11l4.9-5.6" />
    ) : tone === "danger" ? (
      <path d="M5.4 5.4l5.2 5.2M10.6 5.4l-5.2 5.2" />
    ) : tone === "warning" || tone === "attention" ? (
      <path d="M8 4.4V8.4l2.4 1.5" />
    ) : tone === "info" ? (
      <path d="M5 6.5h6L8 10.5Z" fill="currentColor" stroke="none" />
    ) : (
      <circle cx="8" cy="8" r="1.8" fill="currentColor" stroke="none" />
    );
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="size-3 shrink-0">
      <circle cx="8" cy="8" r="8" className={cn("fill-current", CHIP_TONE[tone].glyph)} />
      <g fill="none" stroke="white" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        <g className="text-white">{mark}</g>
      </g>
    </svg>
  );
}

export function RefChip({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[26px] items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] leading-4 font-medium whitespace-nowrap",
        CHIP_TONE[tone].chip,
        className,
      )}
    >
      <ChipGlyph tone={tone} />
      {children}
    </span>
  );
}

/** Initials avatar (real names only — no photos exist in Chelth). */
export function InitialsAvatar({
  name,
  size = 32,
  muted = false,
}: {
  name: string | null;
  size?: 32 | 36 | 38 | 52 | 84 | 90;
  muted?: boolean;
}) {
  const initials =
    (name ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "–";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        size === 32 && "size-8 text-[11px]",
        size === 36 && "size-9 text-xs",
        size === 38 && "size-[38px] text-xs",
        size === 52 && "size-[52px] text-base",
        size === 84 && "size-[84px] text-[26px]",
        size === 90 && "size-[90px] text-[28px]",
        muted
          ? "bg-neutral-soft text-neutral-soft-foreground"
          : "bg-chelth-mint-mist text-chelth-teal-dark",
      )}
    >
      {initials}
    </span>
  );
}

/** Solid KPI glyphs (reference tiles use filled icons). Decorative. */
export type KpiGlyphName = "people" | "calendar" | "alert" | "building" | "clock" | "document";

const KPI_GLYPHS: Record<KpiGlyphName, ReactNode> = {
  people: (
    <>
      <circle cx="12" cy="7.2" r="3.6" />
      <circle cx="5.6" cy="9" r="2.6" />
      <circle cx="18.4" cy="9" r="2.6" />
      <path d="M6.5 20.5v-2.8a5.5 5.5 0 0 1 11 0v2.8Z" />
      <path d="M1.2 20.5v-2a4.2 4.2 0 0 1 4.3-4.2c.6 0 1.2.1 1.7.3a7.2 7.2 0 0 0-1.9 4.6v1.3Z" />
      <path d="M22.8 20.5v-2a4.2 4.2 0 0 0-4.3-4.2c-.6 0-1.2.1-1.7.3a7.2 7.2 0 0 1 1.9 4.6v1.3Z" />
    </>
  ),
  calendar: (
    <path
      fillRule="evenodd"
      d="M7 2.5a1 1 0 0 1 1 1V5h8V3.5a1 1 0 1 1 2 0V5h1a2.5 2.5 0 0 1 2.5 2.5v11A2.5 2.5 0 0 1 19 21H5a2.5 2.5 0 0 1-2.5-2.5v-11A2.5 2.5 0 0 1 5 5h1V3.5a1 1 0 0 1 1-1ZM4.5 10v8.5c0 .3.2.5.5.5h14c.3 0 .5-.2.5-.5V10ZM7 12h2v2H7Zm4 0h2v2h-2Zm4 0h2v2h-2Zm-8 3.5h2v2H7Zm4 0h2v2h-2Z"
    />
  ),
  alert: (
    <path
      fillRule="evenodd"
      d="M12 2.2 20 5.3v6.1c0 5-3.4 9.1-8 10.4-4.6-1.3-8-5.4-8-10.4V5.3Zm-1 5.3v5.5h2V7.5Zm0 7.3v2.1h2v-2.1Z"
    />
  ),
  building: (
    <path
      fillRule="evenodd"
      d="M4 21V5.5L12 2l8 3.5V21h1.5v1.5h-19V21ZM7 8h2v2H7Zm4 0h2v2h-2Zm4 0h2v2h-2ZM7 12h2v2H7Zm4 0h2v2h-2Zm4 0h2v2h-2Zm-8 4h2v2H7Zm8 0h2v2h-2Zm-4.5 1.5h3V21h-3Z"
    />
  ),
  clock: (
    <path
      fillRule="evenodd"
      d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19ZM11 6.5V12.6l4.3 2.6 1-1.7-3.3-2V6.5Z"
    />
  ),
  document: (
    <path
      fillRule="evenodd"
      d="M6 2.5h8.5L19.5 7.5V20A1.5 1.5 0 0 1 18 21.5H6A1.5 1.5 0 0 1 4.5 20V4A1.5 1.5 0 0 1 6 2.5Zm8 1.6V8h3.9ZM8 11h8v1.6H8Zm0 3.6h8v1.6H8Zm0 3.5h5.5v1.5H8Z"
    />
  ),
};

export function KpiGlyph({ name }: { name: KpiGlyphName }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
      {KPI_GLYPHS[name]}
    </svg>
  );
}

/**
 * Overview KPI tiles (lg): a soft luminous gradient of the tile tint with a
 * white inner highlight, and a deliberate icon colour — teal, blue, coral.
 */
const KPI_TILE_LUMINOUS: Record<"teal" | "info" | "danger" | "warning", string> = {
  teal: "bg-[linear-gradient(145deg,#e6f9f3,#ccefe3)] text-[#00666a]",
  info: "bg-[linear-gradient(145deg,#eaf3fe,#d3e5fc)] text-info-indicator",
  danger: "bg-[linear-gradient(145deg,#fdeeed,#f8d8d5)] text-danger-indicator",
  warning: "bg-[linear-gradient(145deg,#fef7ea,#fbe9cc)] text-warning-indicator",
};

const KPI_TILE: Record<"teal" | "info" | "danger" | "warning", string> = {
  teal: "bg-chelth-mint-mist text-chelth-teal",
  info: "bg-info-soft text-info-indicator",
  danger: "bg-danger-soft text-danger-indicator",
  warning: "bg-warning-soft text-warning-indicator",
};

/**
 * Reference KPI card (Operations Overview 129 px / Shifts 122 px): solid
 * glyph tile, label, large value, supporting line and a footer line. The
 * whole card is one link when it filters to a view.
 */
export function RefKpiCard({
  label,
  value,
  supporting,
  footer,
  glyph,
  icon,
  tone,
  href,
  active = false,
  size = "lg",
}: {
  label: string;
  value: ReactNode;
  supporting?: ReactNode;
  /** Footer line: a chip, an icon + note, or a "View … →" action. */
  footer?: ReactNode;
  glyph: KpiGlyphName;
  /** Overrides the glyph with an icon from the existing icon set (Operations Overview). */
  icon?: ReactNode;
  tone: keyof typeof KPI_TILE;
  href?: Route;
  active?: boolean;
  /** lg: Operations Overview; md: Shifts; sm: Workforce (value first, 100 px). */
  size?: "lg" | "md" | "sm";
}) {
  const lg = size === "lg";
  const sm = size === "sm";
  const tile = (
    <span
      aria-hidden="true"
      className={cn(
        "hidden shrink-0 items-center justify-center rounded-[10px] sm:inline-flex",
        lg
          ? "size-[62px] [&>svg]:size-[34px]"
          : sm
            ? "size-[54px] [&>svg]:size-[30px]"
            : "size-[57px] [&>svg]:size-[30px]",
        lg || sm
          ? cn(
              KPI_TILE_LUMINOUS[tone],
              "shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(13,47,66,0.06)]",
            )
          : KPI_TILE[tone],
      )}
    >
      {icon ?? <KpiGlyph name={glyph} />}
    </span>
  );
  const body = sm ? (
    // Locked Workforce stat card: value first, then label and supporting line.
    <>
      {tile}
      <span className="flex min-w-0 flex-col">
        <span className={cn(REF_TEXT.kpiValue, "leading-[30px]")}>{value}</span>
        <span className={REF_TEXT.kpiLabel}>{label}</span>
        {supporting ? <span className={REF_TEXT.kpiSupporting}>{supporting}</span> : null}
        {active ? <span className="mt-1 text-xs font-semibold text-primary">Showing</span> : null}
      </span>
    </>
  ) : (
    <>
      {tile}
      <span className={cn("flex min-w-0 flex-col", lg ? "sm:mt-[7px]" : "sm:mt-[3px]")}>
        <span className={lg ? REF_TEXT.kpiLabel : REF_TEXT.kpiLabelMd}>{label}</span>
        <span className={lg ? REF_TEXT.kpiValue : REF_TEXT.kpiValueMd}>{value}</span>
        {supporting ? (
          <span className={cn(REF_TEXT.kpiSupporting, !lg && "mt-0.5")}>{supporting}</span>
        ) : null}
        {footer ? (
          <span
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1 min-[1440px]:flex-nowrap min-[1440px]:whitespace-nowrap",
              lg ? "mt-1.5" : "mt-3.5",
            )}
          >
            {footer}
          </span>
        ) : null}
        {active ? <span className="mt-1 text-xs font-semibold text-primary">Showing</span> : null}
      </span>
    </>
  );
  const classes = cn(
    lg || sm ? REF_CARD_FROSTED : REF_CARD,
    "flex min-h-11 min-w-0 gap-4 p-3 break-words",
    sm ? "items-center sm:gap-5 sm:px-4 xl:min-h-[100px]" : "items-start",
    lg && "sm:gap-6 sm:pt-3 xl:min-h-[133px]",
    size === "md" && "sm:gap-7 sm:p-3.5 xl:h-[140px]",
    active && "border-primary ring-1 ring-primary",
    href && "transition-colors hover:border-primary/60",
  );
  if (!href) return <div className={classes}>{body}</div>;
  return (
    <Link href={href} aria-current={active ? "true" : undefined} className={classes}>
      {body}
    </Link>
  );
}

/** KPI footer pieces. */
export function KpiAction({ children }: { children: ReactNode }) {
  return (
    <span className="text-[12.75px] leading-[18px] text-primary">
      {children} <span aria-hidden="true">→</span>
    </span>
  );
}

export function KpiNote({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[12.75px] leading-[18px]",
        CHIP_TONE[tone].chip.split(" ").find((c) => c.startsWith("text-")),
      )}
    >
      <ChipGlyph tone={tone} />
      {children}
    </span>
  );
}
