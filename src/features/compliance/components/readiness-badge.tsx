import { Badge, type BadgeProps } from "@/components/ui/badge";
import { READINESS_LABELS, type ReadinessStatus } from "@/lib/domain/credentials";

const TONE: Record<ReadinessStatus, NonNullable<BadgeProps["tone"]>> = {
  ready: "success",
  action_required: "warning",
  not_eligible: "danger",
};

export function ReadinessBadge({ status }: { status: ReadinessStatus }) {
  return <Badge tone={TONE[status]}>{READINESS_LABELS[status]}</Badge>;
}
