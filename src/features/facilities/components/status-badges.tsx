import { Badge, type BadgeProps } from "@/components/ui/badge";
import {
  FACILITY_STATUS_LABELS,
  type FacilityStatus,
  RELATIONSHIP_STATUS_LABELS,
  type RelationshipStatus,
} from "@/lib/domain/vocabulary";

const FACILITY_TONE: Record<FacilityStatus, NonNullable<BadgeProps["tone"]>> = {
  active: "success",
  inactive: "neutral",
  archived: "warning",
};

const RELATIONSHIP_TONE: Record<RelationshipStatus, NonNullable<BadgeProps["tone"]>> = {
  pending: "info",
  active: "success",
  suspended: "warning",
  ended: "neutral",
};

export function FacilityStatusBadge({ status }: { status: FacilityStatus }) {
  return <Badge tone={FACILITY_TONE[status]}>{FACILITY_STATUS_LABELS[status]}</Badge>;
}

export function RelationshipStatusBadge({ status }: { status: RelationshipStatus }) {
  return <Badge tone={RELATIONSHIP_TONE[status]}>{RELATIONSHIP_STATUS_LABELS[status]}</Badge>;
}
