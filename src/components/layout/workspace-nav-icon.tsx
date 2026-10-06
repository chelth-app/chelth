import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import type { WorkspaceNavIcon as IconName } from "./workspace-navigation-model";

/*
 * Inline line icons for the workspace navigation (no icon dependency, CSP
 * safe). Decorative: every icon sits next to a visible text label.
 */
const PATHS: Record<IconName, ReactNode> = {
  overview: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h5v-6h4v6h5V9.5" />
    </>
  ),
  operations: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  shifts: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  attendance: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  timesheets: (
    <>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M10 13h6M10 17h6" />
    </>
  ),
  workforce: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
    </>
  ),
  facilities: (
    <>
      <path d="M4 21V5l8-2v18M12 7l8 2v12" />
      <path d="M2 21h20M7.5 8h1M7.5 12h1M7.5 16h1M15.5 12h1M15.5 16h1" />
    </>
  ),
  compliance: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.3 7.5 9.5 4.3-1.2 7.5-5 7.5-9.5V6z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  rates: (
    <>
      <path d="M3 12.5V4a1 1 0 0 1 1-1h8.5L21 11.5 12.5 20z" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
  pricing: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2" />
    </>
  ),
  payroll: (
    <>
      <rect x="2.5" y="6" width="19" height="13" rx="2" />
      <circle cx="12" cy="12.5" r="2.5" />
      <path d="M6 9.5v.01M18 15.5v.01" />
    </>
  ),
  invoices: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  requests: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 2.5h6v3H9zM9 11h6M9 15h4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
};

export function WorkspaceNavIcon({
  name,
  className,
  strokeWidth = 1.75,
  duotone = false,
}: {
  name: IconName;
  className?: string;
  /** Heavier strokes for large tiles (locked P2 KPI icons). */
  strokeWidth?: number;
  /** Duotone: the same outline with a soft tinted fill (locked P2 KPI tiles). */
  duotone?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={duotone ? "currentColor" : "none"}
      fillOpacity={duotone ? 0.28 : undefined}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn("size-5 shrink-0", className)}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Small UI glyphs used by the shell chrome (menu, close, chevron). */
export function ShellGlyph({
  name,
  className,
}: {
  name: "menu" | "close" | "chevron-down" | "check";
  className?: string;
}) {
  const paths = {
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  } as const;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn("size-5 shrink-0", className)}
    >
      {paths[name]}
    </svg>
  );
}
