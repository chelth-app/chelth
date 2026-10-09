"use server";

/**
 * Workforce Server Actions. Authorization, lifecycle rules and audit live in
 * the RPCs; organisationId is used for navigation/revalidation only.
 */
import { revalidatePath } from "next/cache";

import { issueInvitation, type IssuedInvite } from "@/features/organisations";
import { type ActionState, runAction } from "@/lib/actions/run-action";
import { requireAuthIdentity } from "@/lib/auth/session";
import { ROLES } from "@/lib/authz";
import { AppError, normalizeError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataToObject, parseInput } from "@/lib/validation";

import {
  addWorkerNoteSchema,
  inviteWorkerSchema,
  setWorkerStatusSchema,
  updateWorkerSchema,
} from "./schemas";

function workforcePath(organisationId: string, workerId?: string) {
  return workerId
    ? (`/app/organisations/${organisationId}/workforce/${workerId}` as const)
    : (`/app/organisations/${organisationId}/workforce` as const);
}

/**
 * Invites a healthcare worker. The role is fixed server-side here; the
 * worker record is created by the database when the invitation is accepted.
 */
export async function inviteWorkerAction(
  _state: ActionState<IssuedInvite>,
  formData: FormData,
): Promise<ActionState<IssuedInvite>> {
  return runAction("workforce.inviteWorker", async () => {
    const input = parseInput(inviteWorkerSchema, formDataToObject(formData));
    const issued = await issueInvitation({
      organisationId: input.organisationId,
      email: input.email,
      roleKey: ROLES.AGENCY_HEALTHCARE_WORKER,
    }).catch((error: unknown) => {
      // Workforce wording for the "already a member" case (same rule, clearer copy).
      if (normalizeError(error).code === "ALREADY_A_MEMBER") {
        throw new AppError("ALREADY_IN_WORKFORCE", { cause: error });
      }
      throw error;
    });
    revalidatePath(workforcePath(input.organisationId));
    return issued;
  });
}

export async function setWorkerStatusAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("workforce.setWorkerStatus", async () => {
    const input = parseInput(setWorkerStatusSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_agency_worker_status", {
      p_worker_id: input.workerId,
      p_status: input.status,
    });
    if (error) throw error;
    revalidatePath(workforcePath(input.organisationId, input.workerId));
    return null;
  });
}

export async function updateWorkerAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("workforce.updateWorker", async () => {
    const input = parseInput(updateWorkerSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("update_agency_worker", {
      p_worker_id: input.workerId,
      p_worker_reference: input.workerReference,
    });
    if (error) throw error;
    revalidatePath(workforcePath(input.organisationId, input.workerId));
    return null;
  });
}

export async function addWorkerNoteAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("workforce.addWorkerNote", async () => {
    const input = parseInput(addWorkerNoteSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("add_agency_worker_note", {
      p_worker_id: input.workerId,
      p_body: input.body,
    });
    if (error) throw error;
    revalidatePath(workforcePath(input.organisationId, input.workerId));
    return null;
  });
}
