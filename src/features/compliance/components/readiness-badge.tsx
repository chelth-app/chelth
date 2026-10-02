import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { READINESS_LABELS, type ReadinessStatus } from "@/lib/domain/credentials";

const TONE: Record<ReadinessStatus, StatusTone> = {
  ready: "success",
  action_required: "warning",
  not_eligible: "danger",
};

export function ReadinessBadge({ status }: { status: ReadinessStatus }) {
  return <StatusChip tone={TONE[status]}>{READINESS_LABELS[status]}</StatusChip>;
}
