import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export type StateIconName =
  | "empty"
  | "error"
  | "loading"
  | "search"
  | "lock"
  | "mail"
  | "key"
  | "shield"
  | "check"
  | "refresh";

const PATHS: Record<Exclude<StateIconName, "loading">, ReactNode> = {
  empty: (
    <>
      <path d="M4 13h4l1.5 3h5L16 13h4" />
      <path d="M5.5 6.5 4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5l-1.5-6.5A1 1 0 0 0 17.5 5.7h-11a1 1 0 0 0-1 .8z" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="3.5" />
      <path d="m10.5 12.5 8-8M16 7l2.5 2.5M14 9l2 2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.3 7.5 9.5 4.3-1.2 7.5-5 7.5-9.5V6z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.8 2.8L16.5 9.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </>
  ),
};

/**
 * Icon tile for system states.
 *  - `flat` (default): the small mint tile used by functional empty states.
 *  - `luminous`: the locked drawer / KPI tile language (soft radial tint,
 *    white inner highlight) for full-page auth and system states; coral for
 *    errors.
 * The spinner stops under prefers-reduced-motion.
 */
export function StateIcon({
  name,
  variant = "flat",
  className,
}: {
  name: StateIconName;
  variant?: "flat" | "luminous";
  className?: string;
}) {
  const error = name === "error";
  const luminous = variant === "luminous";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        luminous
          ? cn(
              "size-14 rounded-[14px] shadow-[0_6px_16px_rgba(0,90,96,0.14),inset_0_1px_0_rgba(255,255,255,0.9)]",
              error
                ? "bg-[radial-gradient(circle_at_30%_25%,#fff6f5_0%,#fbdcd8_50%,#f5bfb9_100%)] text-[#b42318]"
                : "bg-[radial-gradient(circle_at_30%_25%,#f4fdfa_0%,#d3f2e8_45%,#a9e3d3_100%)] text-chelth-teal-dark",
            )
          : cn(
              "size-11 rounded-lg",
              error
                ? "bg-danger-soft text-danger-soft-foreground"
                : "bg-chelth-mint-mist text-chelth-teal-dark",
            ),
        className,
      )}
    >
      {name === "loading" ? (
        <span
          className={cn(
            "animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none",
            luminous ? "size-6" : "size-5",
          )}
        />
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={luminous ? 2 : 1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
          className={luminous ? "size-6" : "size-5"}
        >
          {PATHS[name]}
        </svg>
      )}
    </span>
  );
}
