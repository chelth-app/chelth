"use server";

/**
 * Organisation, membership, role and invitation Server Actions.
 *
 * Pattern (docs/architecture/AUTHORIZATION_MODEL.md#server-action-pattern):
 *   parseInput → requireAuthIdentity → explicit organisation context →
 *   RPC (authorises capability, enforces AAL2 + ceiling, mutates, audits
 *   in one transaction) → ActionResult
 *
 * Authorization is NOT decided here. These actions never skip the RPC based on
 * UI state, never trust a role from the client, and never read the active-
 * organisation cookie for decisions. `organisationId` in forms is used for
 * navigation/revalidation only; RPCs derive the organisation from the target
 * row (membership, invite) or check the capability in the organisation named.
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { z } from "zod";

import type { IssuedInviteView } from "@/components/shared/issued-invite-link";
import { type ActionState, runAction } from "@/lib/actions/run-action";
import { requireAuthIdentity } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SUPPORTED_LOCALES } from "@/lib/i18n/terminology";
import { formDataToObject, parseInput } from "@/lib/validation";

import {
  clearPendingInviteToken,
  readPendingInviteToken,
  writeActiveOrganisationPreference,
} from "./context";
import { type InvitationDelivery, deliverInvitation } from "./invitation-delivery";
import { getMyCapabilities, getOrganisation } from "./queries";
import { isWorkspaceStaff } from "./workspace-navigation";
import {
  createOrganisationSchema,
  inviteIdSchema,
  inviteMemberSchema,
  inviteTokenSchema,
  membershipRoleSchema,
  membershipStatusSchema,
  selectOrganisationSchema,
} from "./schemas";

function organisationPath(organisationId: string) {
  return `/app/organisations/${organisationId}` as const;
}

function slugFromName(name: string): string {
  const base =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "organisation";
  // Random suffix: avoids collisions and makes slugs non-enumerable.
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
  return `${base}-${suffix}`;
}

/** Same-origin base URL for links shown to the user (Origin is verified by Next for actions). */
async function requestOrigin(): Promise<string> {
  const origin = (await headers()).get("origin");
  if (!origin) throw new AppError("INTERNAL", { internalMessage: "Missing Origin header" });
  return origin;
}

// -----------------------------------------------------------------------------
// Organisations
// -----------------------------------------------------------------------------

export async function createOrganisationAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let organisationId: string | null = null;
  const result = await runAction("organisations.create", async () => {
    const input = parseInput(createOrganisationSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    // Only agencies are self-serve; the creator's owner role is derived by the RPC.
    const { data, error } = await supabase.rpc("create_organisation", {
      p_type: "agency",
      p_name: input.name,
      p_slug: slugFromName(input.name),
    });
    if (error) throw error;
    organisationId = data;
    return null;
  });
  if (result.ok && organisationId) redirect(organisationPath(organisationId));
  return result;
}

/** Remembers a UI preference, then navigates. Never an authorization input. */
export async function selectOrganisationAction(formData: FormData): Promise<void> {
  const input = parseInput(selectOrganisationSchema, formDataToObject(formData));
  await requireAuthIdentity();
  // Only remember organisations the caller can actually see.
  if (await getOrganisation(input.organisationId)) {
    await writeActiveOrganisationPreference(input.organisationId);
  }
  redirect(organisationPath(input.organisationId));
}

// -----------------------------------------------------------------------------
// Invitations (issuer side)
// -----------------------------------------------------------------------------

/**
 * Outcome of issuing (or re-issuing) an invitation. The link is returned ONLY
 * when it was not emailed, so the issuer can share it; after a successful
 * send it is never exposed again.
 */
export type IssuedInvite = IssuedInviteView & { delivery: InvitationDelivery };

async function namesFor(organisationId: string, roleKey: string) {
  const supabase = await createSupabaseServerClient();
  const [organisation, role] = await Promise.all([
    getOrganisation(organisationId),
    supabase.from("roles").select("name").eq("key", roleKey).maybeSingle(),
  ]);
  return { organisationName: organisation?.name ?? "CHELTH", roleName: role.data?.name ?? roleKey };
}

async function deliverIssuedInvite(input: {
  organisationId: string;
  inviteId: string;
  email: string;
  roleKey: string;
  token: string;
  expiresAt: string;
  reissued: boolean;
}): Promise<IssuedInvite> {
  const inviteUrl = `${await requestOrigin()}/invite/${input.token}`;
  const delivery = await deliverInvitation({
    inviteId: input.inviteId,
    email: input.email,
    inviteUrl,
    expiresAt: input.expiresAt,
    ...(await namesFor(input.organisationId, input.roleKey)),
  });
  return {
    email: input.email,
    expiresAt: input.expiresAt,
    delivery,
    inviteUrl: delivery === "sent" ? null : inviteUrl,
    reissued: input.reissued,
  };
}

/**
 * Creates an invitation (RPC: authorises, applies the capability ceiling,
 * audits) and then delivers it post-commit. Shared by member and worker
 * invitations; exported through the feature index.
 *
 * If the email already has a pending invitation for the same role, the RPC
 * re-issues it instead (token rotated, old link invalid, fresh expiry; no
 * second invitation) and `reissued` is true.
 */
export async function issueInvitation(input: {
  organisationId: string;
  email: string;
  roleKey: string;
}): Promise<IssuedInvite> {
  await requireAuthIdentity();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_organisation_invite", {
    p_organisation_id: input.organisationId,
    p_email: input.email,
    p_role_key: input.roleKey,
  });
  if (error) throw error;
  const issued = data[0];
  if (!issued) throw new AppError("INTERNAL", { internalMessage: "Invite RPC returned no row" });
  revalidatePath(organisationPath(input.organisationId), "layout");
  return deliverIssuedInvite({
    organisationId: input.organisationId,
    inviteId: issued.invite_id,
    email: input.email,
    roleKey: input.roleKey,
    token: issued.invite_token,
    expiresAt: issued.invite_expires_at,
    reissued: issued.invite_reissued,
  });
}

export async function inviteMemberAction(
  _state: ActionState<IssuedInvite>,
  formData: FormData,
): Promise<ActionState<IssuedInvite>> {
  return runAction("organisations.invite", async () => {
    const input = parseInput(inviteMemberSchema, formDataToObject(formData));
    return issueInvitation(input);
  });
}

export async function resendInviteAction(
  _state: ActionState<IssuedInvite>,
  formData: FormData,
): Promise<ActionState<IssuedInvite>> {
  return runAction("organisations.resendInvite", async () => {
    const input = parseInput(inviteIdSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    // Recipient and role come from the database, never from the form.
    const { data: invites, error: listError } = await supabase.rpc("list_organisation_invites", {
      p_organisation_id: input.organisationId,
    });
    if (listError) throw listError;
    const invite = invites.find((row) => row.invite_id === input.inviteId);
    if (!invite) throw new AppError("NOT_FOUND", { internalMessage: "Invite not in organisation" });

    const { data, error } = await supabase.rpc("resend_organisation_invite", {
      p_invite_id: input.inviteId,
    });
    if (error) throw error;
    const issued = data[0];
    if (!issued) throw new AppError("INTERNAL", { internalMessage: "Resend RPC returned no row" });
    revalidatePath(organisationPath(input.organisationId), "layout");
    return deliverIssuedInvite({
      organisationId: input.organisationId,
      inviteId: input.inviteId,
      email: invite.invitee_email,
      roleKey: invite.invite_role_key,
      token: issued.invite_token,
      expiresAt: issued.invite_expires_at,
      reissued: true,
    });
  });
}

export async function revokeInviteAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("organisations.revokeInvite", async () => {
    const input = parseInput(inviteIdSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("revoke_organisation_invite", {
      p_invite_id: input.inviteId,
    });
    if (error) throw error;
    revalidatePath(organisationPath(input.organisationId), "layout");
    return null;
  });
}

// -----------------------------------------------------------------------------
// Invitations (invitee side)
// -----------------------------------------------------------------------------

export async function acceptInviteAction(
  _state: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  let organisationId: string | null = null;
  let destination: string | null = null;
  const result = await runAction("organisations.acceptInvite", async () => {
    await requireAuthIdentity();
    // The token comes from the httpOnly cookie, never from form input: the
    // client cannot substitute organisation, role or token in this request.
    const token = inviteTokenSchema.safeParse(await readPendingInviteToken());
    if (!token.success) throw new AppError("INVITE_INVALID");
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("accept_organisation_invite", {
      p_token: token.data,
    });
    if (error) throw error;
    const accepted = data[0];
    if (!accepted) throw new AppError("INVITE_INVALID");
    await clearPendingInviteToken();
    organisationId = accepted.organisation_id;
    destination = await postAcceptDestination(accepted.organisation_id);
    return null;
  });
  if (result.ok && organisationId) redirect(destination ?? organisationPath(organisationId));
  return result;
}

/**
 * Where a newly accepted member lands. A self-service-only member with a
 * worker record (the worker frame's own rule) goes straight to My Shifts;
 * everyone else goes to the organisation as before. Multi-agency workers keep
 * their other memberships untouched.
 */
async function postAcceptDestination(organisationId: string): Promise<string> {
  const identity = await requireAuthIdentity();
  const supabase = await createSupabaseServerClient();
  const [grants, worker] = await Promise.all([
    getMyCapabilities(organisationId),
    supabase
      .from("agency_workers")
      .select("id")
      .eq("agency_organisation_id", organisationId)
      .eq("profile_id", identity.userId)
      .limit(1),
  ]);
  const isWorkerOnly = !isWorkspaceStaff(grants.map((grant) => grant.capabilityKey));
  return isWorkerOnly && (worker.data?.length ?? 0) > 0
    ? `${organisationPath(organisationId)}/my-shifts`
    : organisationPath(organisationId);
}

export async function dismissInviteAction(): Promise<void> {
  await clearPendingInviteToken();
  redirect("/app");
}

// -----------------------------------------------------------------------------
// Roles and membership lifecycle
// -----------------------------------------------------------------------------

export async function assignRoleAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("organisations.assignRole", async () => {
    const input = parseInput(membershipRoleSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("assign_membership_role", {
      p_membership_id: input.membershipId,
      p_role_key: input.roleKey,
    });
    if (error) throw error;
    revalidatePath(organisationPath(input.organisationId), "layout");
    return null;
  });
}

export async function revokeRoleAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("organisations.revokeRole", async () => {
    const input = parseInput(membershipRoleSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("revoke_membership_role", {
      p_membership_id: input.membershipId,
      p_role_key: input.roleKey,
    });
    if (error) throw error;
    revalidatePath(organisationPath(input.organisationId), "layout");
    return null;
  });
}

export async function setMembershipStatusAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("organisations.setMembershipStatus", async () => {
    const input = parseInput(membershipStatusSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_membership_status", {
      p_membership_id: input.membershipId,
      p_status: input.status,
    });
    if (error) throw error;
    revalidatePath(organisationPath(input.organisationId), "layout");
    return null;
  });
}

const organisationLocaleSchema = z.object({
  organisationId: z.uuid(),
  locale: z.enum(["", ...SUPPORTED_LOCALES]).transform((value) => (value ? value : null)),
});

/** Workspace language and spelling (P0-E9-3F; organisation.manage, AAL2, audited). */
export async function setOrganisationLocaleAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("organisations.setLocale", async () => {
    const input = parseInput(organisationLocaleSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_organisation_locale", {
      p_organisation_id: input.organisationId,
      ...(input.locale ? { p_locale: input.locale } : {}),
    });
    if (error) throw error;
    revalidatePath(`/app/organisations/${input.organisationId}`, "layout");
    return null;
  });
}
