import type { StatusTone } from "@/components/ui/status-chip";
import type { WorkerStatus } from "@/lib/domain/vocabulary";

/** Same tones as WorkerStatusBadge (features/workforce). */
export const WORKER_STATUS_TONE: Record<WorkerStatus, StatusTone> = {
  onboarding: "info",
  active: "success",
  inactive: "neutral",
  suspended: "warning",
  terminated: "danger",
};
