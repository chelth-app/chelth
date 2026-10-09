import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

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
