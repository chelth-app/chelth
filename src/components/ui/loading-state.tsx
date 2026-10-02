import { cn } from "@/lib/utils/cn";

import { StateIcon } from "./state-icon";

type LoadingStateProps = { label?: string; className?: string };

/** Loading state (P9). Announces politely to screen readers via role="status". */
export function LoadingState({ label = "Loading…", className }: LoadingStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground",
        className,
      )}
    >
      <StateIcon name="loading" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
