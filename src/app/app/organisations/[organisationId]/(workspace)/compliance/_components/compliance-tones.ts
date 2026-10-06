import type { StatusTone } from "@/components/ui/status-chip";
import type { ComplianceReason, VerificationOutcome } from "@/lib/domain/credentials";

/*
 * Presentation of the readiness engine's own results. Nothing here decides
 * eligibility: every row is one engine reason for one worker and requirement.
 */

/** Register groups (reference summary states), each a set of engine reasons. */
export const REGISTER_GROUPS = ["up_to_date", "expiring", "review", "missing", "blocked"] as const;
export type RegisterGroup = (typeof REGISTER_GROUPS)[number];

export const REGISTER_GROUP_LABELS: Record<RegisterGroup, string> = {
  up_to_date: "Up to date",
  expiring: "Expiring soon",
  review: "Needs review",
  missing: "Missing",
  blocked: "Expired, rejected or other",
};

const GROUP_OF: Record<ComplianceReason, RegisterGroup> = {
  MET: "up_to_date",
  EXPIRING_SOON: "expiring",
  UNVERIFIED_CREDENTIAL: "review",
  DOCUMENT_NOT_CLEARED: "review",
  MISSING_CREDENTIAL: "missing",
  CREDENTIAL_NOT_SHARED: "missing",
  NOT_SUBMITTED: "missing",
  DOCUMENT_MISSING: "missing",
  EXPIRED_CREDENTIAL: "blocked",
  VERIFICATION_REJECTED: "blocked",
  INSUFFICIENT_VALIDITY: "blocked",
  WRONG_JURISDICTION: "blocked",
  WORKER_NOT_ACTIVE: "blocked",
  DISCIPLINE_NOT_SET: "blocked",
};

export function registerGroup(reason: ComplianceReason): RegisterGroup {
  return GROUP_OF[reason];
}

/**
 * Semantic tone per engine reason: green healthy, amber approaching expiry or
 * waiting on the worker, blue pending checks (verification, security scan),
 * red missing / expired / rejected, slate worker-level conditions.
 */
export function complianceTone(reason: ComplianceReason): StatusTone {
  switch (reason) {
    case "MET":
      return "success";
    case "EXPIRING_SOON":
    case "NOT_SUBMITTED":
      return "warning";
    case "UNVERIFIED_CREDENTIAL":
    case "DOCUMENT_NOT_CLEARED":
      return "info";
    case "WORKER_NOT_ACTIVE":
    case "DISCIPLINE_NOT_SET":
      return "neutral";
    default:
      return "danger";
  }
}

/** Same tones as VerificationBadge (features/credentials). */
export const VERIFICATION_TONE: Record<VerificationOutcome, StatusTone> = {
  under_review: "info",
  verified: "success",
  rejected: "danger",
};
