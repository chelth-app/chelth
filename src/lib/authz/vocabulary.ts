/**
 * Authorization vocabulary — the single TypeScript source for keys that also
 * exist in the database.
 *
 * - Enum-backed types come from the generated database types (no duplication).
 * - Role and capability keys are database rows (reference data created by
 *   migrations). They are mirrored here as typed constants; the integration
 *   test `vocabulary-drift.test.ts` fails if the two ever disagree.
 *
 * Application code checks CAPABILITIES, never role names. Role keys are used
 * only to offer roles in pickers and to display them.
 */
import type { Database } from "@/types/database.types";

type Enums = Database["public"]["Enums"];

export type OrganisationType = Enums["organisation_type"];
export type OrganisationStatus = Enums["organisation_status"];
export type MembershipStatus = Enums["membership_status"];
export type ProfileStatus = Enums["profile_status"];
export type InviteStatus = Enums["invite_status"];

export const CAPABILITIES = {
  ORGANISATION_VIEW: "organisation.view",
  ORGANISATION_MANAGE: "organisation.manage",
  MEMBERSHIP_VIEW: "membership.view",
  MEMBERSHIP_INVITE: "membership.invite",
  MEMBERSHIP_MANAGE: "membership.manage",
  ROLE_ASSIGN: "role.assign",
  AUDIT_VIEW: "audit.view",
  WORKER_VIEW: "worker.view",
  WORKER_MANAGE: "worker.manage",
  WORKER_NOTES_VIEW: "worker.notes.view",
  WORKER_NOTES_MANAGE: "worker.notes.manage",
  FACILITY_VIEW: "facility.view",
  FACILITY_MANAGE: "facility.manage",
  RELATIONSHIP_VIEW: "relationship.view",
  RELATIONSHIP_MANAGE: "relationship.manage",
  CREDENTIAL_VIEW: "credential.view",
  CREDENTIAL_REVIEW: "credential.review",
  CREDENTIAL_VERIFY: "credential.verify",
  CREDENTIAL_REQUIREMENTS_VIEW: "credential.requirements.view",
  CREDENTIAL_REQUIREMENTS_MANAGE: "credential.requirements.manage",
  COMPLIANCE_VIEW: "compliance.view",
  SHIFT_VIEW: "shift.view",
  SHIFT_CREATE: "shift.create",
  SHIFT_MANAGE: "shift.manage",
  SHIFT_REQUEST: "shift.request",
  ASSIGNMENT_VIEW: "assignment.view",
  ASSIGNMENT_MANAGE: "assignment.manage",
} as const;

export type CapabilityKey = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

export const ROLES = {
  AGENCY_ADMIN: "agency.admin",
  AGENCY_OPERATIONS_MANAGER: "agency.operations_manager",
  AGENCY_RECRUITER: "agency.recruiter",
  AGENCY_SCHEDULER: "agency.scheduler",
  AGENCY_CREDENTIALING_OFFICER: "agency.credentialing_officer",
  AGENCY_FINANCE: "agency.finance",
  AGENCY_HEALTHCARE_WORKER: "agency.healthcare_worker",
  FACILITY_ADMIN: "facility.admin",
  FACILITY_SCHEDULER: "facility.scheduler",
  FACILITY_SUPERVISOR: "facility.supervisor",
} as const;

export type RoleKey = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLE_KEYS: readonly RoleKey[] = Object.values(ROLES);
export const ALL_CAPABILITY_KEYS: readonly CapabilityKey[] = Object.values(CAPABILITIES);

export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === "string" && (ALL_ROLE_KEYS as readonly string[]).includes(value);
}

/** Roles valid for an organisation type (key namespace = organisation type). */
export function rolesForOrganisationType(type: OrganisationType): RoleKey[] {
  return ALL_ROLE_KEYS.filter((key) => key.startsWith(`${type}.`));
}

/** Audit action keys written by the database (for filtering/display). */
export const AUDIT_ACTIONS = {
  ORGANISATION_CREATED: "organisation.created",
  ORGANISATION_STATUS_CHANGED: "organisation.status_changed",
  MEMBERSHIP_CREATED: "membership.created",
  MEMBERSHIP_REACTIVATED: "membership.reactivated",
  MEMBERSHIP_STATUS_CHANGED: "membership.status_changed",
  ROLE_ASSIGNED: "role.assigned",
  ROLE_REVOKED: "role.revoked",
  INVITE_CREATED: "invite.created",
  INVITE_RESENT: "invite.resent",
  INVITE_REVOKED: "invite.revoked",
  INVITE_ACCEPTED: "invite.accepted",
  INVITE_ACCEPTANCE_FAILED: "invite.acceptance_failed",
  PROFILE_STATUS_CHANGED: "profile.status_changed",
  PLATFORM_ADMIN_GRANTED: "platform.admin_granted",
  PLATFORM_ADMIN_REVOKED: "platform.admin_revoked",
  PLATFORM_ORGANISATIONS_LISTED: "platform.organisations_listed",
  WORKER_CREATED: "worker.created",
  WORKER_UPDATED: "worker.updated",
  WORKER_STATUS_CHANGED: "worker.status_changed",
  WORKER_NOTE_ADDED: "worker.note_added",
  FACILITY_CREATED: "facility.created",
  FACILITY_UPDATED: "facility.updated",
  FACILITY_STATUS_CHANGED: "facility.status_changed",
  FACILITY_LOCATION_CREATED: "facility.location_created",
  FACILITY_LINKED: "facility.linked",
  RELATIONSHIP_CREATED: "relationship.created",
  RELATIONSHIP_STATUS_CHANGED: "relationship.status_changed",
  CREDENTIAL_CREATED: "credential.created",
  CREDENTIAL_VERSION_CREATED: "credential.version_created",
  CREDENTIAL_VERSION_SUBMITTED: "credential.version_submitted",
  CREDENTIAL_WITHDRAWN: "credential.withdrawn",
  CREDENTIAL_DOCUMENT_UPLOADED: "credential.document_uploaded",
  CREDENTIAL_DOCUMENT_SCANNED: "credential.document_scanned",
  CREDENTIAL_DOCUMENT_ACCESSED: "credential.document_accessed",
  CREDENTIAL_DOCUMENT_ACCESS_DENIED: "credential.document_access_denied",
  CREDENTIAL_SHARED: "credential.shared",
  CREDENTIAL_SHARE_REVOKED: "credential.share_revoked",
  CREDENTIAL_VERIFICATION_SUBMITTED: "credential.verification_submitted",
  CREDENTIAL_REVIEW_STARTED: "credential.review_started",
  CREDENTIAL_VERIFIED: "credential.verified",
  CREDENTIAL_REJECTED: "credential.rejected",
  CREDENTIAL_REQUIREMENT_CREATED: "credential.requirement_created",
  CREDENTIAL_REQUIREMENT_UPDATED: "credential.requirement_updated",
  WORKER_DISCIPLINE_CHANGED: "worker.discipline_changed",
  COMPLIANCE_SHARED: "compliance.shared",
  COMPLIANCE_SHARE_REVOKED: "compliance.share_revoked",
  COMPLIANCE_VIEWED_BY_FACILITY: "compliance.viewed_by_facility",
  SHIFT_CREATED: "shift.created",
  SHIFT_SUBMITTED: "shift.submitted",
  SHIFT_OPENED: "shift.opened",
  SHIFT_UPDATED: "shift.updated",
  SHIFT_CANCELLED: "shift.cancelled",
  SHIFT_COMPLETED: "shift.completed",
  SHIFT_INTERNAL_NOTE_ADDED: "shift.internal_note_added",
  SHIFT_ASSIGNMENTS_VIEWED_BY_FACILITY: "shift.assignments_viewed_by_facility",
  ASSIGNMENT_CREATED: "assignment.created",
  ASSIGNMENT_ACCEPTED: "assignment.accepted",
  ASSIGNMENT_DECLINED: "assignment.declined",
  ASSIGNMENT_CANCELLED: "assignment.cancelled",
  ASSIGNMENT_REJECTED_BY_COMPLIANCE: "assignment.rejected_by_compliance",
  ASSIGNMENT_REJECTED_BY_CONFLICT: "assignment.rejected_by_conflict",
  ASSIGNMENT_REJECTED_BY_CAPACITY: "assignment.rejected_by_capacity",
  SHIFT_OFFER_CREATED: "shift.offer_created",
  SHIFT_OFFER_ACCEPTED: "shift.offer_accepted",
  SHIFT_OFFER_DECLINED: "shift.offer_declined",
  SHIFT_OFFER_EXPIRED: "shift.offer_expired",
  SHIFT_OFFER_CANCELLED: "shift.offer_cancelled",
  ASSIGNMENT_ISSUE_OPENED: "assignment.issue_opened",
  ASSIGNMENT_ISSUE_RESOLVED: "assignment.issue_resolved",
  ASSIGNMENT_READINESS_RECHECKED: "assignment.readiness_rechecked",
  RELATIONSHIP_OPERATIONS_APPLIED: "relationship.operations_applied",
  NOTIFICATION_FAILED: "notification.failed",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "organisation.created": "Organisation created",
  "organisation.status_changed": "Organisation status changed",
  "membership.created": "Member joined",
  "membership.reactivated": "Membership reactivated",
  "membership.status_changed": "Membership status changed",
  "role.assigned": "Role assigned",
  "role.revoked": "Role revoked",
  "invite.created": "Invitation sent",
  "invite.resent": "Invitation resent",
  "invite.revoked": "Invitation revoked",
  "invite.accepted": "Invitation accepted",
  "invite.acceptance_failed": "Invitation acceptance failed",
  "profile.status_changed": "Account status changed",
  "platform.admin_granted": "Platform admin granted",
  "platform.admin_revoked": "Platform admin revoked",
  "platform.organisations_listed": "Platform organisation list viewed",
  "worker.created": "Worker record created",
  "worker.updated": "Worker record updated",
  "worker.status_changed": "Worker status changed",
  "worker.note_added": "Internal note added",
  "facility.created": "Client facility created",
  "facility.updated": "Client facility updated",
  "facility.status_changed": "Client facility status changed",
  "facility.location_created": "Facility location added",
  "facility.linked": "Facility linked to organisation",
  "relationship.created": "Relationship created",
  "relationship.status_changed": "Relationship status changed",
  "credential.created": "Credential added",
  "credential.version_created": "Credential renewal started",
  "credential.version_submitted": "Credential submitted",
  "credential.withdrawn": "Credential withdrawn",
  "credential.document_uploaded": "Credential document uploaded",
  "credential.document_scanned": "Credential document scanned",
  "credential.document_accessed": "Credential document opened",
  "credential.document_access_denied": "Credential document access denied",
  "credential.shared": "Credential shared",
  "credential.share_revoked": "Credential sharing stopped",
  "credential.verification_submitted": "Credential awaiting review",
  "credential.review_started": "Credential review started",
  "credential.verified": "Credential verified",
  "credential.rejected": "Credential rejected",
  "credential.requirement_created": "Credential requirement added",
  "credential.requirement_updated": "Credential requirement changed",
  "worker.discipline_changed": "Worker discipline changed",
  "compliance.shared": "Compliance shared with facility",
  "compliance.share_revoked": "Compliance sharing stopped",
  "compliance.viewed_by_facility": "Facility viewed shared compliance",
  "shift.created": "Shift created",
  "shift.submitted": "Staffing request submitted",
  "shift.opened": "Shift opened",
  "shift.updated": "Shift updated",
  "shift.cancelled": "Shift cancelled",
  "shift.completed": "Shift completed",
  "shift.internal_note_added": "Internal shift note added",
  "shift.assignments_viewed_by_facility": "Facility viewed assigned workers",
  "assignment.created": "Worker assigned",
  "assignment.accepted": "Assignment accepted",
  "assignment.declined": "Assignment declined",
  "assignment.cancelled": "Assignment cancelled",
  "assignment.rejected_by_compliance": "Assignment refused (eligibility)",
  "assignment.rejected_by_conflict": "Assignment refused (schedule conflict)",
  "assignment.rejected_by_capacity": "Assignment refused (capacity)",
  "shift.offer_created": "Shift offered to worker",
  "shift.offer_accepted": "Shift offer accepted",
  "shift.offer_declined": "Shift offer declined",
  "shift.offer_expired": "Shift offer expired",
  "shift.offer_cancelled": "Shift offer withdrawn",
  "assignment.issue_opened": "Assignment needs attention",
  "assignment.issue_resolved": "Assignment issue resolved",
  "assignment.readiness_rechecked": "Assignment readiness re-checked",
  "relationship.operations_applied": "Relationship change applied to upcoming work",
  "notification.failed": "Notification could not be delivered",
};

export function auditActionLabel(action: string): string {
  return (AUDIT_ACTION_LABELS as Record<string, string>)[action] ?? action;
}
