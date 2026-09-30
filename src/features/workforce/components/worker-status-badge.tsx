import { Badge, type BadgeProps } from "@/components/ui/badge";
import { WORKER_STATUS_LABELS, type WorkerStatus } from "@/lib/domain/vocabulary";

const TONE: Record<WorkerStatus, NonNullable<BadgeProps["tone"]>> = {
  onboarding: "info",
  active: "success",
  inactive: "neutral",
  suspended: "warning",
  terminated: "danger",
};

export function WorkerStatusBadge({ status }: { status: WorkerStatus }) {
  return <Badge tone={TONE[status]}>{WORKER_STATUS_LABELS[status]}</Badge>;
}
