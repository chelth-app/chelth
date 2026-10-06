import type { ReactNode } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import type { WorkspaceNavIcon as IconName } from "@/components/layout/workspace-navigation-model";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";

/*
 * Locked presentation shared by Rates and Pricing (CHELTH-LOCKED-VISUAL-
 * SYSTEM.md): the same filter control and quiet empty tile as Timesheets,
 * Facilities and Compliance. Presentation only.
 */

/** Heading ink (locked typography). */
export const INK = "text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]";

/** Locked filter control (Facilities): 46 px, hairline border, optional leading icon. */
export function LockedFilterSelect({
  id,
  name,
  label,
  value,
  className,
  icon,
  children,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  className?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex h-11 min-w-36 items-center gap-2 rounded-md border border-chelth-border bg-white/90 pl-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring sm:h-[46px]",
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="text-chelth-navy [&>svg]:size-[18px]">
          {icon}
        </span>
      ) : null}
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <select
        id={id}
        name={name}
        defaultValue={value}
        className="h-full min-w-0 flex-1 bg-transparent pr-3 text-base font-medium text-chelth-navy outline-none sm:text-[13.5px]"
      >
        {children}
      </select>
    </span>
  );
}

/** Deliberate empty state inside a locked panel: neutral tile, title, one line. */
export function LockedEmpty({
  icon,
  title,
  note,
  children,
}: {
  icon: IconName;
  title: string;
  note: string;
  /** Optional real action. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-[5px] py-3">
      <span
        aria-hidden="true"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-muted text-muted-foreground [&>svg]:size-[19px]"
      >
        <WorkspaceNavIcon name={icon} strokeWidth={2} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <h3 className="text-[14px] leading-5 font-medium text-slate-600">{title}</h3>
        <span className="text-[12.5px] leading-[18px] text-muted-foreground">{note}</span>
      </span>
      {children}
    </div>
  );
}

/** 36 px mint icon tile (locked drawer / record row tile); content may be a numeral. */
export function LockedTile({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[linear-gradient(145deg,#e6f9f3,#ccefe3)] font-display text-[15px] font-semibold text-chelth-teal-dark [&>svg]:size-[18px]"
    >
      {children}
    </span>
  );
}

/** Locked header primary action (Facilities "Add Facility"): anchors to an in-page form. */
export function HeaderAddAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex h-11 items-center gap-2.5 rounded-[7px] bg-chelth-teal-dark px-5 text-[15px] font-medium text-white shadow-[0_2px_6px_rgba(0,58,64,0.25)] hover:bg-chelth-teal sm:h-[47px] sm:min-w-[158px] sm:justify-center"
    >
      <span aria-hidden="true" className="text-xl leading-none font-light">
        +
      </span>
      {children}
    </a>
  );
}

const NOTICE_TONE = {
  info: { box: "border-[rgba(47,116,240,0.12)] bg-info-soft/45", dot: "bg-info-indicator" },
  warning: {
    box: "border-[rgba(180,120,20,0.10)] bg-warning-soft/40",
    dot: "bg-warning-indicator",
  },
  danger: { box: "border-[rgba(229,72,77,0.14)] bg-danger-soft/45", dot: "bg-danger-indicator" },
} as const;

/**
 * Locked status note (as Timesheet Details "Attendance Verification"): a
 * semantic glyph, a title and one line. `role` keeps live-region semantics.
 */
export function LockedNotice({
  tone,
  title,
  children,
  role,
}: {
  tone: keyof typeof NOTICE_TONE;
  title: string;
  children?: ReactNode;
  role?: "status" | "alert";
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-3 rounded-[10px] border px-3.5 py-3",
        NOTICE_TONE[tone].box,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-white",
          NOTICE_TONE[tone].dot,
        )}
      >
        <svg
          viewBox="0 0 16 16"
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
        >
          {tone === "info" ? (
            <path d="M8 7.5v4M8 4.5v.01" strokeLinecap="round" />
          ) : (
            <path d="M8 4.5v4.5M8 11.5v.01" strokeLinecap="round" />
          )}
        </svg>
      </span>
      <span className="flex flex-col">
        <span className="text-[14px] leading-5 font-medium text-chelth-navy">{title}</span>
        {children ? (
          <span className="text-[12.5px] leading-[18px] text-slate-600">{children}</span>
        ) : null}
      </span>
    </div>
  );
}
