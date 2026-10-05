import { cn } from "@/lib/utils/cn";

/**
 * Location pin used beside facility names in the locked P2/P3 tables and the
 * shift details drawer. Decorative: the facility name is always visible text.
 */
export function LocationPin({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn("size-4 shrink-0 text-primary", className)}
    >
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  );
}
