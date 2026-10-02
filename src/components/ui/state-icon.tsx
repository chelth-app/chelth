import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export type StateIconName = "empty" | "error" | "loading" | "search" | "lock";

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
};

/** Decorative icon tile for system states (empty / error / loading). */
export function StateIcon({ name, className }: { name: StateIconName; className?: string }) {
  const tone =
    name === "error"
      ? "bg-danger-soft text-danger-soft-foreground"
      : "bg-chelth-mint-mist text-chelth-teal-dark";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-lg",
        tone,
        className,
      )}
    >
      {name === "loading" ? (
        <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
          className="size-5"
        >
          {PATHS[name]}
        </svg>
      )}
    </span>
  );
}
