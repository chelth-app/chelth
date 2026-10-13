"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { clearPendingInviteToken, readPendingInviteToken } from "@/features/organisations";
import { type ActionState, runAction } from "@/lib/actions/run-action";
import { requireAuthIdentity } from "@/lib/auth/session";
import { getEmailSender } from "@/lib/email";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataToObject, parseInput } from "@/lib/validation";

import { buildFacilityConnectionEmail } from "./emails/facility-connection-email";
import {
  acceptFacilityConnectionSchema,
  facilityConnectionInviteSchema,
  inviteFacilityConnectionSchema,
} from "./schemas";

/*
 * P0-E9-4A.1: agency-initiated facility connection. The RPCs decide
 * everything (the agency is resolved from its own facility record, never from
 * the browser; email binding; consent; linking). These actions send the email
 * after commit and record the outcome.
 */

export type ConnectionInviteResult = {
  email: string;
  delivery: "sent" | "skipped" | "failed";
  /** Only when the email was not sent, so the agency can share it. */
  inviteUrl: string | null;
};

async function requestOrigin(): Promise<string> {
  const origin = (await headers()).get("origin");
  if (!origin) throw new AppError("INTERNAL", { internalMessage: "Missing Origin header" });
  return origin;
}

async function deliverConnectionInvite(input: {
  inviteId: string;
  email: string;
  token: string;
  expiresAt: string;
  agencyName: string;
  facilityName: string;
}): Promise<ConnectionInviteResult> {
  const inviteUrl = `${await requestOrigin()}/invite/${input.token}`;
  const result = await getEmailSender().send(
    buildFacilityConnectionEmail({
      to: input.email,
      agencyName: input.agencyName,
      facilityName: input.facilityName,
      inviteUrl,
      expiresAt: input.expiresAt,
      idempotencyKey: `facility-connection-${input.inviteId}-${new Date(input.expiresAt).getTime()}`,
    }),
  );
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_facility_connection_delivery", {
    p_invite_id: input.inviteId,
    p_status: result.status,
    p_provider: result.provider,
    ...(result.status === "failed" ? { p_error_code: result.errorCode } : {}),
  });
  const context = {
    inviteId: input.inviteId,
    provider: result.provider,
    deliveryStatus: result.status,
    ...(error ? { recordErrorCode: error.code } : {}),
  };
  if (result.status === "failed" || error)
    logger.warn("Facility connection email not delivered", context);
  else logger.info("Facility connection email processed", context);
  return {
    email: input.email,
    delivery: result.status,
    inviteUrl: result.status === "sent" ? null : inviteUrl,
  };
}

function facilityPath(organisationId: string, facilityId: string) {
  return `/app/organisations/${organisationId}/facilities/${facilityId}` as const;
}

export async function inviteFacilityConnectionAction(
  _state: ActionState<ConnectionInviteResult>,
  formData: FormData,
): Promise<ActionState<ConnectionInviteResult>> {
  return runAction("facilities.inviteConnection", async () => {
    const input = parseInput(inviteFacilityConnectionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const email = input.email.trim().toLowerCase();
    const { data, error } = await supabase.rpc("invite_facility_connection", {
      p_facility_id: input.facilityId,
      p_email: email,
      ...(input.contactName ? { p_contact_name: input.contactName } : {}),
    });
    if (error) throw error;
    const issued = data[0];
    if (!issued) throw new AppError("INTERNAL", { internalMessage: "No invitation returned" });
    // No revalidation here: the form shows the outcome (and, when the email was
    // not sent, the one-time link to share); the page shows "Pending" on the next visit.
    return deliverConnectionInvite({
      inviteId: issued.invite_id,
      email,
      token: issued.invite_token,
      expiresAt: issued.invite_expires_at,
      agencyName: issued.agency_name,
      facilityName: issued.facility_name,
    });
  });
}

export async function resendFacilityConnectionAction(
  _state: ActionState<ConnectionInviteResult>,
  formData: FormData,
): Promise<ActionState<ConnectionInviteResult>> {
  return runAction("facilities.resendConnection", async () => {
    const input = parseInput(facilityConnectionInviteSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("resend_facility_connection_invite", {
      p_invite_id: input.inviteId,
    });
    if (error) throw error;
    const issued = data[0];
    if (!issued) throw new AppError("INTERNAL", { internalMessage: "No invitation returned" });
    revalidatePath(facilityPath(input.organisationId, input.facilityId));
    return deliverConnectionInvite({
      inviteId: issued.invite_id,
      email: issued.email,
      token: issued.invite_token,
      expiresAt: issued.invite_expires_at,
      agencyName: issued.agency_name,
      facilityName: issued.facility_name,
    });
  });
}

export async function revokeFacilityConnectionAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("facilities.revokeConnection", async () => {
    const input = parseInput(facilityConnectionInviteSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("revoke_facility_connection_invite", {
      p_invite_id: input.inviteId,
    });
    if (error) throw error;
    revalidatePath(facilityPath(input.organisationId, input.facilityId));
    return null;
  });
}

/**
 * Facility representative: accept the invitation held in the pending-invite
 * cookie (never a token from the form). Creates the facility or connects one
 * the caller administers, then opens the facility workspace.
 */
export async function acceptFacilityConnectionAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let facilityOrganisationId: string | null = null;
  const result = await runAction("facilities.acceptConnection", async () => {
    const input = parseInput(acceptFacilityConnectionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const token = await readPendingInviteToken();
    if (!token) throw new AppError("INVITE_INVALID");
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("accept_facility_connection_invite", {
      p_token: token,
      p_mode: input.mode,
      ...(input.mode === "connect" && input.facilityOrganisationId
        ? { p_facility_organisation_id: input.facilityOrganisationId }
        : {}),
      ...(input.mode === "create" && input.facilityName
        ? { p_facility_name: input.facilityName }
        : {}),
    });
    if (error) {
      if (error.code === "CH404") throw new AppError("INVITE_INVALID");
      throw error;
    }
    facilityOrganisationId = data[0]?.facility_organisation_id ?? null;
    await clearPendingInviteToken();
    return null;
  });
  if (result.ok && facilityOrganisationId) {
    redirect(`/app/organisations/${facilityOrganisationId}` as Route);
  }
  return result;
}
