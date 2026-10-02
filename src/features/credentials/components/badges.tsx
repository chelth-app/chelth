import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import {
  DOCUMENT_STATUS_LABELS,
  type DocumentStatus,
  VERIFICATION_LABELS,
  type VerificationOutcome,
} from "@/lib/domain/credentials";

const VERIFICATION_TONE: Record<VerificationOutcome, StatusTone> = {
  under_review: "info",
  verified: "success",
  rejected: "danger",
};

const DOCUMENT_TONE: Record<DocumentStatus, StatusTone> = {
  upload_pending: "neutral",
  scanning: "info",
  clean: "success",
  rejected: "danger",
  quarantined: "danger",
};

export function VerificationBadge({ outcome }: { outcome: VerificationOutcome | null }) {
  if (!outcome) return <StatusChip tone="neutral">Not reviewed</StatusChip>;
  return <StatusChip tone={VERIFICATION_TONE[outcome]}>{VERIFICATION_LABELS[outcome]}</StatusChip>;
}

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  return <StatusChip tone={DOCUMENT_TONE[status]}>{DOCUMENT_STATUS_LABELS[status]}</StatusChip>;
}
