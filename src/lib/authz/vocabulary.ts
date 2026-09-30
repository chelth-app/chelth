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
};

export function auditActionLabel(action: string): string {
  return (AUDIT_ACTION_LABELS as Record<string, string>)[action] ?? action;
}
