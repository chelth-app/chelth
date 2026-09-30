import { cn } from "@/lib/utils/cn";

import { Spinner } from "./spinner";

type LoadingStateProps = { label?: string; className?: string };

/** Announces loading politely to screen readers via role="status". */
export function LoadingState({ label = "Loading…", className }: LoadingStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground",
        className,
      )}
    >
      <Spinner size="lg" decorative className="text-primary" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
