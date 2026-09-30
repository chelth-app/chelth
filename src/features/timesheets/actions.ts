"use server";

/**
 * Timesheet Server Actions. They pass ids and decisions to the database,
 * which derives every time value from attendance and enforces the lifecycle,
 * separation of duties and relationship scope. No action accepts minutes or
 * times.
 */
import { revalidatePath } from "next/cache";

import { type ActionState, runAction } from "@/lib/actions/run-action";
import { requireAuthIdentity } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataToObject, parseInput } from "@/lib/validation";

import {
  approveTimesheetSchema,
  facilityDecisionSchema,
  rebuildTimesheetSchema,
  rejectTimesheetSchema,
  reopenTimesheetSchema,
  resolveDisputeSchema,
  submitTimesheetSchema,
  weekStartSchema,
} from "./schemas";

function revalidateTimesheets(organisationId: string) {
  revalidatePath(`/app/organisations/${organisationId}/timesheets`, "layout");
}

function throwIfBlocked(row: { outcome: string; blocking_reasons: string[] } | undefined) {
  if (!row) throw new AppError("INTERNAL", { internalMessage: "no timesheet result" });
  if (row.outcome === "blocked") {
    throw new AppError("TIMESHEET_NOT_READY", {
      internalMessage: `blocked: ${row.blocking_reasons.join(",")}`,
    });
  }
}

export async function submitTimesheetAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("timesheets.submit", async () => {
    const input = parseInput(submitTimesheetSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("submit_timesheet", {
      p_timesheet_id: input.timesheetId,
    });
    if (error) throw error;
    throwIfBlocked(data[0]);
    revalidateTimesheets(input.organisationId);
    return null;
  });
}

export async function approveTimesheetAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("timesheets.approve", async () => {
    const input = parseInput(approveTimesheetSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("approve_timesheet", {
      p_timesheet_id: input.timesheetId,
      p_expected_revision: input.revision,
    });
    if (error) throw error;
    throwIfBlocked(data[0]);
    revalidateTimesheets(input.organisationId);
    return null;
  });
}

export async function rejectTimesheetAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("timesheets.reject", async () => {
    const input = parseInput(rejectTimesheetSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("reject_timesheet", {
      p_timesheet_id: input.timesheetId,
      p_reason: input.reason,
      ...(input.note ? { p_note: input.note } : {}),
    });
    if (error) throw error;
    revalidateTimesheets(input.organisationId);
    return null;
  });
}

export async function reopenTimesheetAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("timesheets.reopen", async () => {
    const input = parseInput(reopenTimesheetSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("reopen_timesheet", {
      p_timesheet_id: input.timesheetId,
      p_reason: input.reason,
      ...(input.note ? { p_note: input.note } : {}),
    });
    if (error) throw error;
    revalidateTimesheets(input.organisationId);
    return null;
  });
}

/** Deterministic recalculation from attendance (idempotent; never edits approved output). */
export async function rebuildTimesheetAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("timesheets.rebuild", async () => {
    const input = parseInput(rebuildTimesheetSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("rebuild_timesheet", {
      p_timesheet_id: input.timesheetId,
    });
    if (error) throw error;
    revalidateTimesheets(input.organisationId);
    return null;
  });
}

export async function facilityDecisionAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("timesheets.facilityDecision", async () => {
    const input = parseInput(facilityDecisionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("facility_decide_timesheet_entry", {
      p_entry_id: input.entryId,
      p_expected_revision: input.revision,
      p_sign_off: input.decision === "sign_off",
      ...(input.decision === "dispute" && input.reason ? { p_dispute_reason: input.reason } : {}),
      ...(input.note ? { p_note: input.note } : {}),
    });
    if (error) throw error;
    revalidateTimesheets(input.organisationId);
    return null;
  });
}

export async function resolveDisputeAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("timesheets.resolveDispute", async () => {
    const input = parseInput(resolveDisputeSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("resolve_timesheet_dispute", {
      p_entry_id: input.entryId,
      ...(input.note ? { p_note: input.note } : {}),
    });
    if (error) throw error;
    revalidateTimesheets(input.organisationId);
    return null;
  });
}

export async function saveWeekStartAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("timesheets.saveWeekStart", async () => {
    const input = parseInput(weekStartSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_agency_timesheet_settings", {
      p_organisation_id: input.organisationId,
      p_week_starts_on: input.weekStartsOn,
    });
    if (error) throw error;
    revalidateTimesheets(input.organisationId);
    return null;
  });
}
