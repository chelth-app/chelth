import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import {
  FACILITY_STATUS_LABELS,
  type FacilityStatus,
  RELATIONSHIP_STATUS_LABELS,
  type RelationshipStatus,
} from "@/lib/domain/vocabulary";

/** Shared with the locked Facilities presentation (same semantics everywhere). */
export const FACILITY_TONE: Record<FacilityStatus, StatusTone> = {
  active: "success",
  inactive: "neutral",
  archived: "warning",
};

export const RELATIONSHIP_TONE: Record<RelationshipStatus, StatusTone> = {
  pending: "info",
  active: "success",
  suspended: "warning",
  ended: "neutral",
};

export function FacilityStatusBadge({ status }: { status: FacilityStatus }) {
  return <StatusChip tone={FACILITY_TONE[status]}>{FACILITY_STATUS_LABELS[status]}</StatusChip>;
}

export function RelationshipStatusBadge({ status }: { status: RelationshipStatus }) {
  return (
    <StatusChip tone={RELATIONSHIP_TONE[status]}>{RELATIONSHIP_STATUS_LABELS[status]}</StatusChip>
  );
}
