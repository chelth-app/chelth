import { Badge, type BadgeProps } from "@/components/ui/badge";
import {
  DOCUMENT_STATUS_LABELS,
  type DocumentStatus,
  VERIFICATION_LABELS,
  type VerificationOutcome,
} from "@/lib/domain/credentials";

const VERIFICATION_TONE: Record<VerificationOutcome, NonNullable<BadgeProps["tone"]>> = {
  under_review: "info",
  verified: "success",
  rejected: "danger",
};

const DOCUMENT_TONE: Record<DocumentStatus, NonNullable<BadgeProps["tone"]>> = {
  upload_pending: "neutral",
  scanning: "info",
  clean: "success",
  rejected: "danger",
  quarantined: "danger",
};

export function VerificationBadge({ outcome }: { outcome: VerificationOutcome | null }) {
  if (!outcome) return <Badge tone="neutral">Not reviewed</Badge>;
  return <Badge tone={VERIFICATION_TONE[outcome]}>{VERIFICATION_LABELS[outcome]}</Badge>;
}

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  return <Badge tone={DOCUMENT_TONE[status]}>{DOCUMENT_STATUS_LABELS[status]}</Badge>;
}
