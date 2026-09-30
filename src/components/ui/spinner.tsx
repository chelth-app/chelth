import { cn } from "@/lib/utils/cn";

const sizes = { sm: "size-4", md: "size-6", lg: "size-8" } as const;

type SpinnerProps = {
  size?: keyof typeof sizes;
  /** Decorative spinners are hidden from assistive tech (e.g. inside a busy button). */
  decorative?: boolean;
  label?: string;
  className?: string;
};

export function Spinner({
  size = "md",
  decorative = false,
  label = "Loading",
  className,
}: SpinnerProps) {
  return (
    <svg
      className={cn("animate-spin text-current", sizes[size], className)}
      viewBox="0 0 24 24"
      fill="none"
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}
