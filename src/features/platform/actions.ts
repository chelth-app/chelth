"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { deliverInvitation, type InvitationDelivery } from "@/features/organisations";
import { type ActionState, runAction } from "@/lib/actions/run-action";
import { requireAuthIdentity } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataToObject, parseInput } from "@/lib/validation";

import {
  createPlatformOrganisationSchema,
  customerAccountSchema,
  lifecycleSchema,
  linkFacilitySchema,
  planSchema,
  platformInviteSchema,
} from "./schemas";

/*
 * P0-E9-4A: platform control-plane actions. Every rule (active platform
 * grant, AAL2, agency-only accounts, one suspension authority, explicit
 * links, audit) is enforced by the database RPCs; these actions only parse
 * input, call them, and send invitation email after commit.
 */

const PLATFORM = "/platform";

/** Same-origin base URL for invitation links (Origin is verified by Next for actions). */
async function requestOrigin(): Promise<string> {
  const origin = (await headers()).get("origin");
  if (!origin) throw new AppError("INTERNAL", { internalMessage: "Missing Origin header" });
  return origin;
}

function slugFromName(name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "organisation";
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `${base}-${Array.from(bytes, (byte) => (byte % 36).toString(36)).join("")}`;
}

async function ownerRoleName(type: "agency" | "facility"): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("roles")
    .select("name")
    .eq("organisation_type", type)
    .eq("is_owner_role", true)
    .maybeSingle();
  return data?.name ?? (type === "agency" ? "Agency Admin" : "Facility Admin");
}

export type PlatformInviteResult = {
  organisationId: string;
  email: string;
  delivery: InvitationDelivery;
  /** Only when the email was not sent, so the operator can share it. */
  inviteUrl: string | null;
};

async function sendOwnerInvite(input: {
  organisationId: string;
  organisationName: string;
  type: "agency" | "facility";
  inviteId: string;
  email: string;
  token: string;
  expiresAt: string;
}): Promise<PlatformInviteResult> {
  const inviteUrl = `${await requestOrigin()}/invite/${input.token}`;
  const delivery = await deliverInvitation({
    inviteId: input.inviteId,
    email: input.email,
    inviteUrl,
    expiresAt: input.expiresAt,
    organisationName: input.organisationName,
    roleName: await ownerRoleName(input.type),
  });
  return {
    organisationId: input.organisationId,
    email: input.email,
    delivery,
    inviteUrl: delivery === "sent" ? null : inviteUrl,
  };
}

/** Creates an organisation with the existing platform RPC; the owner is invited (never the operator). */
export async function createPlatformOrganisationAction(
  _state: ActionState<PlatformInviteResult>,
  formData: FormData,
): Promise<ActionState<PlatformInviteResult>> {
  return runAction("platform.createOrganisation", async () => {
    const input = parseInput(createPlatformOrganisationSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const email = input.ownerEmail.trim().toLowerCase();
    const { data, error } = await supabase.rpc("platform_create_organisation", {
      p_type: input.type,
      p_name: input.name,
      p_slug: slugFromName(input.name),
      p_owner_email: email,
    });
    if (error) throw error;
    const created = data[0];
    if (!created) throw new AppError("INTERNAL", { internalMessage: "No organisation returned" });
    revalidatePath(PLATFORM, "layout");
    return sendOwnerInvite({
      organisationId: created.organisation_id,
      organisationName: input.name,
      type: input.type,
      inviteId: created.invite_id,
      email,
      token: created.invite_token,
      expiresAt: created.invite_expires_at,
    });
  });
}

/**
 * Links an agency facility record to a facility organisation, then returns to
 * the organisation with the linked record named (the link form itself goes
 * away once the agency has no unlinked records left).
 */
export async function linkFacilityAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let linked: { organisationId: string; recordId: string } | null = null;
  const result = await runAction("platform.linkFacility", async () => {
    const input = parseInput(linkFacilitySchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("platform_link_agency_facility", {
      p_agency_facility_id: input.agencyFacilityId,
      p_facility_organisation_id: input.facilityOrganisationId,
    });
    if (error) throw error;
    revalidatePath(PLATFORM, "layout");
    linked = { organisationId: input.facilityOrganisationId, recordId: input.agencyFacilityId };
    return null;
  });
  if (result.ok && linked) {
    const { organisationId, recordId } = linked;
    redirect(`/platform/organisations/${organisationId}?linked=${recordId}` as Route);
  }
  return result;
}

/** Resends a platform-issued owner invitation (rotates the token; existing invite rules). */
export async function resendPlatformInviteAction(
  _state: ActionState<PlatformInviteResult>,
  formData: FormData,
): Promise<ActionState<PlatformInviteResult>> {
  return runAction("platform.resendInvite", async () => {
    const input = parseInput(platformInviteSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data: detail, error: detailError } = await supabase.rpc("platform_get_customer", {
      p_organisation_id: input.organisationId,
    });
    if (detailError) throw detailError;
    const customer = detail as {
      identity: { name: string; type: "agency" | "facility" };
      invites: { id: string; email: string }[];
    };
    const invite = customer.invites.find((candidate) => candidate.id === input.inviteId);
    if (!invite) throw new AppError("NOT_FOUND");
    const { data, error } = await supabase.rpc("resend_organisation_invite", {
      p_invite_id: input.inviteId,
    });
    if (error) throw error;
    const issued = data[0];
    if (!issued) throw new AppError("INTERNAL", { internalMessage: "No invite returned" });
    revalidatePath(PLATFORM, "layout");
    return sendOwnerInvite({
      organisationId: input.organisationId,
      organisationName: customer.identity.name,
      type: customer.identity.type,
      inviteId: issued.invite_id,
      email: invite.email,
      token: issued.invite_token,
      expiresAt: issued.invite_expires_at,
    });
  });
}

export async function revokePlatformInviteAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("platform.revokeInvite", async () => {
    const input = parseInput(platformInviteSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("revoke_organisation_invite", {
      p_invite_id: input.inviteId,
    });
    if (error) throw error;
    revalidatePath(PLATFORM, "layout");
    return null;
  });
}

export async function saveCustomerAccountAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("platform.saveCustomerAccount", async () => {
    const input = parseInput(customerAccountSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("platform_save_customer_account", {
      p_organisation_id: input.organisationId,
      p_status: input.status,
      ...(input.planKey ? { p_plan_key: input.planKey } : {}),
      ...(input.billingName ? { p_billing_name: input.billingName } : {}),
      ...(input.billingEmail ? { p_billing_email: input.billingEmail } : {}),
      ...(input.trialEndsOn ? { p_trial_ends_on: input.trialEndsOn } : {}),
      ...(input.currentPeriodEndsOn ? { p_current_period_ends_on: input.currentPeriodEndsOn } : {}),
      p_cancel_at_period_end: input.cancelAtPeriodEnd,
      p_reason: input.reason,
    });
    if (error) throw error;
    revalidatePath(PLATFORM, "layout");
    return null;
  });
}

export async function setLifecycleAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("platform.setLifecycle", async () => {
    const input = parseInput(lifecycleSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("platform_set_organisation_lifecycle", {
      p_organisation_id: input.organisationId,
      p_status: input.status,
      p_reason: input.reason,
    });
    if (error) throw error;
    revalidatePath(PLATFORM, "layout");
    return null;
  });
}

export async function savePlanAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("platform.savePlan", async () => {
    const input = parseInput(planSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("platform_save_plan", {
      p_key: input.key,
      p_name: input.name,
      p_status: input.status,
      ...(input.monthlyPrice
        ? { p_monthly_price_minor: Math.round(Number(input.monthlyPrice) * 100) }
        : {}),
      ...(input.currency ? { p_currency: input.currency } : {}),
      ...(input.includedSeats !== undefined ? { p_included_seats: input.includedSeats } : {}),
      ...(input.includedFacilities !== undefined
        ? { p_included_facilities: input.includedFacilities }
        : {}),
    });
    if (error) throw error;
    revalidatePath(PLATFORM, "layout");
    return null;
  });
}
