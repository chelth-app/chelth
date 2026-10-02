import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { WORKER_STATUS_LABELS, type WorkerStatus } from "@/lib/domain/vocabulary";

const TONE: Record<WorkerStatus, StatusTone> = {
  onboarding: "info",
  active: "success",
  inactive: "neutral",
  suspended: "warning",
  terminated: "danger",
};

export function WorkerStatusBadge({ status }: { status: WorkerStatus }) {
  return <StatusChip tone={TONE[status]}>{WORKER_STATUS_LABELS[status]}</StatusChip>;
}
