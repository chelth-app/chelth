import "server-only";

import { cache } from "react";

import { requireAuthIdentity } from "@/lib/auth/session";
import type {
  CapabilityGrant,
  InviteStatus,
  MembershipStatus,
  OrganisationStatus,
  OrganisationType,
} from "@/lib/authz";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * Every query runs as the signed-in user: Row Level Security decides what is
 * returned. Nothing here filters for security in application code.
 */

export type MyMembership = {
  membershipId: string;
  status: MembershipStatus;
  organisation: {
    id: string;
    name: string;
    type: OrganisationType;
    status: OrganisationStatus;
  } | null;
  roleKeys: string[];
};

export async function listMyMemberships(): Promise<MyMembership[]> {
  const identity = await requireAuthIdentity();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organisation_memberships")
    .select(
      "id, status, organisation:organisations(id, name, type, status), roles:membership_roles(role_key, revoked_at)",
    )
    .eq("profile_id", identity.userId);
  if (error) throw error;

  return data
    .map((row) => ({
      membershipId: row.id,
      status: row.status,
      // Null when RLS hides the organisation (e.g. suspended membership).
      organisation: row.organisation,
      roleKeys: row.roles.filter((role) => role.revoked_at === null).map((role) => role.role_key),
    }))
    .sort((a, b) => (a.organisation?.name ?? "").localeCompare(b.organisation?.name ?? ""));
}

export type OrganisationSummary = {
  id: string;
  name: string;
  type: OrganisationType;
  status: OrganisationStatus;
};

/** The organisation if the caller may see it, otherwise null. Memoised per request. */
export const getOrganisation = cache(
  async (organisationId: string): Promise<OrganisationSummary | null> => {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("organisations")
      .select("id, name, type, status")
      .eq("id", organisationId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
);

/** Capabilities the caller holds in the organisation — UI hints only. */
export const getMyCapabilities = cache(
  async (organisationId: string): Promise<CapabilityGrant[]> => {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("my_capabilities", {
      p_organisation_id: organisationId,
    });
    if (error) throw error;
    return data.map((row) => ({
      capabilityKey: row.capability_key,
      isPrivileged: row.is_privileged,
      isSatisfied: row.is_satisfied,
    }));
  },
);

export type OrganisationMember = {
  membershipId: string;
  profileId: string;
  displayName: string | null;
  status: MembershipStatus;
  roleKeys: string[];
};

export async function listMembers(organisationId: string): Promise<OrganisationMember[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organisation_memberships")
    .select(
      "id, profile_id, status, profile:profiles(display_name), roles:membership_roles(role_key, revoked_at)",
    )
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  return data.map((row) => ({
    membershipId: row.id,
    profileId: row.profile_id,
    displayName: row.profile?.display_name ?? null,
    status: row.status,
    roleKeys: row.roles.filter((role) => role.revoked_at === null).map((role) => role.role_key),
  }));
}

export type RoleOption = { key: string; name: string; capabilityKeys: string[] };

/** Roles for an organisation type, with the capabilities each confers. */
export async function listRoles(type: OrganisationType): Promise<RoleOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("roles")
    .select("key, name, role_capabilities(capability_key)")
    .eq("organisation_type", type)
    .order("name");
  if (error) throw error;
  return data.map((role) => ({
    key: role.key,
    name: role.name,
    capabilityKeys: role.role_capabilities.map((rc) => rc.capability_key),
  }));
}

/**
 * Roles the caller could grant: every capability of the role is one the
 * caller holds (mirrors the database capability ceiling, for UI only).
 */
export function assignableRoles(
  roles: readonly RoleOption[],
  grants: readonly CapabilityGrant[],
): RoleOption[] {
  const held = new Set(grants.map((grant) => grant.capabilityKey));
  return roles.filter((role) => role.capabilityKeys.every((capability) => held.has(capability)));
}

export type OrganisationInvite = {
  id: string;
  email: string;
  roleKey: string;
  status: InviteStatus;
  expiresAt: string;
  sendCount: number;
  invitedAt: string;
  /** Real post-commit delivery outcome (reset on every token rotation). */
  deliveryStatus: "not_attempted" | "sent" | "failed" | "skipped";
};

export async function listInvites(organisationId: string): Promise<OrganisationInvite[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_organisation_invites", {
    p_organisation_id: organisationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.invite_id,
    email: row.invitee_email,
    roleKey: row.invite_role_key,
    status: row.invite_status,
    expiresAt: row.invite_expires_at,
    sendCount: row.invite_send_count,
    invitedAt: row.invited_at,
    deliveryStatus: row.invite_delivery_status,
  }));
}

export type AuditEntry = {
  id: string;
  occurredAt: string;
  actorProfileId: string | null;
  action: string;
  targetType: string | null;
  actorAal: string | null;
};

export async function listAuditEvents(organisationId: string): Promise<AuditEntry[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("audit_events")
    .select("id, occurred_at, actor_profile_id, action, target_type, actor_aal")
    .eq("organisation_id", organisationId)
    .order("occurred_at", { ascending: false })
    .limit(25);
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    actorProfileId: row.actor_profile_id,
    action: row.action,
    targetType: row.target_type,
    actorAal: row.actor_aal,
  }));
}

export type InvitePreview = {
  organisationId: string;
  organisationName: string;
  organisationType: OrganisationType;
  roleKey: string;
  roleName: string;
  expiresAt: string;
};

/** Validated, throttled preview for the signed-in invitee; null when invalid. */
export async function previewInvite(token: string): Promise<InvitePreview | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("preview_organisation_invite", { p_token: token });
  if (error) throw error;
  const row = data[0];
  if (!row) return null;
  return {
    organisationId: row.organisation_id,
    organisationName: row.organisation_name,
    organisationType: row.organisation_type,
    roleKey: row.role_key,
    roleName: row.role_name,
    expiresAt: row.invite_expires_at,
  };
}
