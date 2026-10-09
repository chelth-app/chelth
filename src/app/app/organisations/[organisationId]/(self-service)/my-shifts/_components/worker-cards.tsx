import type { ReactNode } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import type { WorkspaceNavIcon as IconName } from "@/components/layout/workspace-navigation-model";
import { LocationPin } from "@/components/ui/location-pin";
import { INK, WORKER_CARD } from "@/components/reference/worker-ui";
import { cn } from "@/lib/utils/cn";

export {
  INK,
  WORKER_CARD,
  WORKER_PRIMARY_CTA,
  WORKER_SECONDARY_CTA,
} from "@/components/reference/worker-ui";

/*
 * Worker Mobile card language (locked Worker Mobile reference, P0-E8-W1, on
 * the locked Chelth system): rounded white cards with the canonical soft
 * depth, a luminous facility tile, icon-led fact rows and semantic state
 * panels. Presentation only — every value comes from the worker's own read
 * models.
 */

/** Section heading row: Manrope 18 / 600 plus an optional supporting line. */
export function WorkerSection({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id={id} className={cn("font-display text-[19px] leading-[26px] font-semibold", INK)}>
          {title}
        </h2>
        {note ? <p className="text-[13px] leading-[18px] text-slate-600">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Luminous icon tile (the W1 facility tile, reusable for other worker records). */
export function WorkerIconTile({ icon, size = "md" }: { icon: IconName; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[12px] bg-[radial-gradient(circle_at_30%_25%,#f4fdfa_0%,#d3f2e8_45%,#a9e3d3_100%)] text-chelth-teal-dark shadow-[0_4px_12px_rgba(0,90,96,0.14),inset_0_1px_0_rgba(255,255,255,0.9)]",
        size === "lg" ? "size-16 [&>svg]:size-8" : "size-12 [&>svg]:size-6",
      )}
    >
      <WorkspaceNavIcon name={icon} strokeWidth={1.9} duotone />
    </span>
  );
}

/** Luminous facility tile (Chelth has no facility photos). */
export function FacilityTile({ size = "md" }: { size?: "md" | "lg" }) {
  return <WorkerIconTile icon="facilities" size={size} />;
}

/** Card identity: facility tile, facility name, one supporting line, status chips. */
export function ShiftIdentity({
  title,
  subtitle,
  chips,
}: {
  title: string;
  subtitle?: ReactNode;
  chips?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <FacilityTile />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className={cn("text-[16px] leading-[22px] font-semibold", INK)}>{title}</p>
        {subtitle ? <p className="text-[13px] leading-[18px] text-slate-600">{subtitle}</p> : null}
        {chips ? <div className="mt-0.5 flex flex-wrap gap-1.5">{chips}</div> : null}
      </div>
    </div>
  );
}

/** Icon-led fact rows (date, time, role, location). */
export function FactRows({
  rows,
}: {
  rows: { icon: IconName | "pin"; label: string; value: ReactNode }[];
}) {
  return (
    <dl className="flex flex-col gap-1.5 text-[14px] leading-5 text-slate-700">
      {rows.map((row) => (
        <div key={row.label} className="flex items-start gap-2.5">
          <dt className="flex w-5 shrink-0 justify-center pt-px text-chelth-teal-dark">
            {row.icon === "pin" ? (
              <LocationPin className="size-[18px]" />
            ) : (
              <WorkspaceNavIcon name={row.icon} strokeWidth={2.1} className="size-[18px]" />
            )}
            <span className="sr-only">{row.label}</span>
          </dt>
          <dd className="min-w-0">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Two recorded times side by side (clock in / clock out), server time. */
export function TimePair({ items }: { items: { label: string; value: string; note?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-2.5">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex flex-col gap-0.5 rounded-[10px] border border-[rgba(18,107,103,0.08)] bg-[#f6fbfa] px-3 py-2.5"
        >
          <dt className="text-[12.5px] leading-4 font-medium text-slate-600">{item.label}</dt>
          <dd className={cn("text-[16px] leading-[22px] font-semibold tabular-nums", INK)}>
            {item.value}
          </dd>
          {item.note ? <dd className="text-[12px] leading-4 text-slate-600">{item.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

const PANEL_TONE = {
  success: {
    box: "border-[rgba(18,107,103,0.12)] bg-[linear-gradient(180deg,#f6fbfa,#eef7f4)]",
    dot: "bg-success-indicator",
  },
  info: { box: "border-[rgba(47,116,240,0.12)] bg-info-soft/40", dot: "bg-info-indicator" },
  warning: {
    box: "border-[rgba(180,120,20,0.12)] bg-warning-soft/40",
    dot: "bg-warning-indicator",
  },
} as const;

/** Semantic state panel: glyph, title, one line, optional extra content. */
export function StatePanel({
  tone,
  title,
  children,
}: {
  tone: keyof typeof PANEL_TONE;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[12px] border px-3.5 py-3 text-[13px] leading-[18px]",
        PANEL_TONE[tone].box,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-white",
          PANEL_TONE[tone].dot,
        )}
      >
        <svg
          viewBox="0 0 16 16"
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
        >
          {tone === "success" ? (
            <path d="m4 8.5 2.5 2.5L12 5.5" strokeLinecap="round" strokeLinejoin="round" />
          ) : tone === "info" ? (
            <path d="M8 7.5v4M8 4.5v.01" strokeLinecap="round" />
          ) : (
            <path d="M8 4.5v4.5M8 11.5v.01" strokeLinecap="round" />
          )}
        </svg>
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[14px] leading-5 font-semibold text-chelth-navy">{title}</p>
        {children}
      </div>
    </div>
  );
}

/** Quiet empty state (locked neutral tile). */
export function WorkerEmpty({
  title,
  note,
  icon = "shifts",
}: {
  title: string;
  note?: string;
  icon?: IconName;
}) {
  return (
    <div className={cn(WORKER_CARD, "flex-row items-center gap-3")}>
      <span
        aria-hidden="true"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-surface-muted text-muted-foreground [&>svg]:size-5"
      >
        <WorkspaceNavIcon name={icon} strokeWidth={2} />
      </span>
      <span className="flex flex-col">
        <h3 className="text-[14.5px] leading-5 font-medium text-slate-700">{title}</h3>
        {note ? <span className="text-[13px] leading-[18px] text-slate-600">{note}</span> : null}
      </span>
    </div>
  );
}
