"use server";

/**
 * Operational messaging Server Actions (P0-E9-3D-S3). Authorisation,
 * idempotency, validation, rate limiting and notification live in the RPCs.
 */
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { type ActionState, runAction } from "@/lib/actions/run-action";
import { requireAuthIdentity } from "@/lib/auth/session";
import { type ActionResult } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataToObject, parseInput } from "@/lib/validation";

import {
  openFacilityThreadSchema,
  openWorkerThreadSchema,
  sendMessageSchema,
  threadIdSchema,
} from "./schemas";

const threadPath = (
  organisationId: string,
  threadId: string,
  surface: "worker" | "staff" = "worker",
) =>
  surface === "worker"
    ? (`/app/organisations/${organisationId}/messages/${threadId}` as const)
    : (`/app/organisations/${organisationId}/conversations/${threadId}` as const);

export type SentMessage = { messageId: string; duplicate: boolean };

/** Sends once per client key: a retried or double-submitted send returns the same message. */
export async function sendMessageAction(
  _state: ActionState<SentMessage>,
  formData: FormData,
): Promise<ActionState<SentMessage>> {
  return runAction("messaging.send", async () => {
    const input = parseInput(sendMessageSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("send_message", {
      p_thread_id: input.threadId,
      p_body: input.body,
      p_client_key: input.clientKey,
    });
    if (error) throw error;
    const row = data[0];
    revalidatePath(threadPath(input.organisationId, input.threadId, "worker"));
    revalidatePath(threadPath(input.organisationId, input.threadId, "staff"));
    return { messageId: row?.message_id ?? "", duplicate: row?.duplicate ?? false };
  });
}

export async function markThreadReadAction(threadId: string): Promise<ActionResult<null>> {
  return runAction("messaging.markRead", async () => {
    const id = parseInput(threadIdSchema, threadId);
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("mark_thread_read", { p_thread_id: id });
    if (error) throw error;
    return null;
  });
}

/** Opens (or reuses) the worker ↔ agency thread, optionally about a shift, and goes to it. */
export async function openWorkerThreadAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let target: string | null = null;
  const result = await runAction("messaging.openWorkerThread", async () => {
    const input = parseInput(openWorkerThreadSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("open_worker_thread", {
      p_agency_worker_id: input.agencyWorkerId,
      ...(input.shiftId ? { p_shift_id: input.shiftId } : {}),
    });
    if (error) throw error;
    target = threadPath(input.organisationId, data, input.surface);
    return null;
  });
  if (result.ok && target) redirect(target as Route);
  return result;
}

/** Opens (or reuses) the agency ↔ facility thread for a relationship / request, and goes to it. */
export async function openFacilityThreadAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let target: string | null = null;
  const result = await runAction("messaging.openFacilityThread", async () => {
    const input = parseInput(openFacilityThreadSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("open_facility_thread", {
      p_relationship_id: input.relationshipId,
      ...(input.shiftId ? { p_shift_id: input.shiftId } : {}),
    });
    if (error) throw error;
    target = threadPath(input.organisationId, data, input.surface);
    return null;
  });
  if (result.ok && target) redirect(target as Route);
  return result;
}
