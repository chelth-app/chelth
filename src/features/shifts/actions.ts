"use server";

/**
 * Shift and assignment Server Actions. Authorization, eligibility, capacity,
 * schedule conflicts, lifecycle and audit all live in the database RPCs; these
 * actions only validate input shape and translate outcomes.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { type ActionState, runAction } from "@/lib/actions/run-action";
import { requireAuthIdentity } from "@/lib/auth/session";
import { ASSIGNMENT_BLOCK_ERROR, localDate } from "@/lib/domain/shifts";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataToObject, parseInput } from "@/lib/validation";

import { explainBlockReasons } from "./explain";
import { listCredentialTypeNames, parseFindings } from "./queries";
import {
  agencyOfferActionSchema,
  assignmentActionSchema,
  assignWorkerSchema,
  cancelAssignmentSchema,
  cancelShiftSchema,
  createShiftSchema,
  facilityRequestSchema,
  offerActionSchema,
  offerShiftSchema,
  shiftActionSchema,
  shiftNoteSchema,
  updateShiftDetailsSchema,
} from "./schemas";

function shiftPath(organisationId: string, shiftId?: string) {
  return shiftId
    ? (`/app/organisations/${organisationId}/shifts/${shiftId}` as const)
    : (`/app/organisations/${organisationId}/shifts` as const);
}

function requestsPath(organisationId: string, shiftId?: string) {
  return shiftId
    ? (`/app/organisations/${organisationId}/staffing-requests/${shiftId}` as const)
    : (`/app/organisations/${organisationId}/staffing-requests` as const);
}

type ScheduleInput = {
  disciplineKey: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  requestedHeadcount: number;
  instructions?: string | undefined;
  externalReference?: string | undefined;
};

function scheduleRpcFields(input: ScheduleInput) {
  return {
    p_discipline_key: input.disciplineKey,
    p_shift_date: input.shiftDate,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_requested_headcount: input.requestedHeadcount,
    ...(input.instructions ? { p_instructions: input.instructions } : {}),
    ...(input.externalReference ? { p_external_reference: input.externalReference } : {}),
  };
}

// -----------------------------------------------------------------------------
// Agency shift commands
// -----------------------------------------------------------------------------
export async function createShiftAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let created: { organisationId: string; shiftId: string } | null = null;
  const result = await runAction("shifts.create", async () => {
    const input = parseInput(createShiftSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_shift", {
      p_agency_facility_id: input.facilityLocation.first,
      p_facility_location_id: input.facilityLocation.second,
      p_open: input.open,
      ...scheduleRpcFields(input),
    });
    if (error) throw error;
    created = { organisationId: input.organisationId, shiftId: data };
    return null;
  });
  if (result.ok && created) {
    const { organisationId, shiftId } = created;
    redirect(shiftPath(organisationId, shiftId));
  }
  return result;
}

export async function openShiftAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("shifts.open", async () => {
    const input = parseInput(shiftActionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("open_shift", { p_shift_id: input.shiftId });
    if (error) throw error;
    revalidatePath(shiftPath(input.organisationId, input.shiftId));
    return null;
  });
}

export async function completeShiftAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("shifts.complete", async () => {
    const input = parseInput(shiftActionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("complete_shift", { p_shift_id: input.shiftId });
    if (error) throw error;
    revalidatePath(shiftPath(input.organisationId, input.shiftId));
    return null;
  });
}

export async function cancelShiftAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("shifts.cancel", async () => {
    const input = parseInput(cancelShiftSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("cancel_shift", {
      p_shift_id: input.shiftId,
      p_reason: input.reason,
    });
    if (error) throw error;
    revalidatePath(shiftPath(input.organisationId, input.shiftId));
    revalidatePath(requestsPath(input.organisationId, input.shiftId));
    return null;
  });
}

/** Headcount, instructions and reference; scheduling identity is kept as stored. */
export async function updateShiftDetailsAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("shifts.updateDetails", async () => {
    const input = parseInput(updateShiftDetailsSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data: shift, error: readError } = await supabase
      .from("shifts")
      .select("facility_location_id, discipline_key, start_at, end_at, timezone")
      .eq("id", input.shiftId)
      .maybeSingle();
    if (readError) throw readError;
    if (!shift) throw new AppError("SHIFT_NOT_FOUND");
    const wallClock = (instant: string) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: shift.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(instant));
    const { error } = await supabase.rpc("update_shift", {
      p_shift_id: input.shiftId,
      p_facility_location_id: shift.facility_location_id,
      p_discipline_key: shift.discipline_key,
      p_shift_date: localDate(shift.start_at, shift.timezone),
      p_start_time: wallClock(shift.start_at),
      p_end_time: wallClock(shift.end_at),
      p_requested_headcount: input.requestedHeadcount,
      p_instructions: input.instructions ?? "",
      p_external_reference: input.externalReference ?? "",
    });
    if (error) throw error;
    // The unit has its own audited setter (no-op when unchanged).
    const unit = await supabase.rpc("set_shift_unit", {
      p_shift_id: input.shiftId,
      p_unit_label: input.unitLabel ?? "",
    });
    if (unit.error) throw unit.error;
    revalidatePath(shiftPath(input.organisationId, input.shiftId));
    return null;
  });
}

export async function addShiftNoteAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("shifts.addNote", async () => {
    const input = parseInput(shiftNoteSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("add_shift_internal_note", {
      p_shift_id: input.shiftId,
      p_body: input.body,
    });
    if (error) throw error;
    revalidatePath(shiftPath(input.organisationId, input.shiftId));
    return null;
  });
}

// -----------------------------------------------------------------------------
// Assignment commands
// -----------------------------------------------------------------------------
/**
 * The server decides. A refusal is recorded by the database (decision +
 * audit) and returned here as a structured error with plain-language reasons
 * in `fieldErrors.reasons`.
 */
export async function assignWorkerAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("shifts.assign", async () => {
    const input = parseInput(assignWorkerSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("assign_worker_to_shift", {
      p_shift_id: input.shiftId,
      p_agency_worker_id: input.workerId,
    });
    if (error) throw error;
    const decision = data[0];
    if (!decision) throw new AppError("INTERNAL", { internalMessage: "no assignment decision" });
    revalidatePath(shiftPath(input.organisationId, input.shiftId));
    if (decision.outcome === "refused" && decision.primary_reason) {
      const typeNames = await listCredentialTypeNames();
      throw new AppError(ASSIGNMENT_BLOCK_ERROR[decision.primary_reason], {
        internalMessage: `assignment refused: ${decision.block_reasons.join(",")}`,
        fieldErrors: {
          reasons: explainBlockReasons(
            decision.block_reasons,
            parseFindings(decision.compliance_findings),
            typeNames,
          ),
        },
      });
    }
    return null;
  });
}

export async function cancelAssignmentAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("shifts.cancelAssignment", async () => {
    const input = parseInput(cancelAssignmentSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("cancel_shift_assignment", {
      p_assignment_id: input.assignmentId,
      p_reason: input.reason,
    });
    if (error) throw error;
    revalidatePath(shiftPath(input.organisationId, input.shiftId));
    return null;
  });
}

export async function acceptAssignmentAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("shifts.acceptAssignment", async () => {
    const input = parseInput(assignmentActionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("accept_shift_assignment", {
      p_assignment_id: input.assignmentId,
    });
    if (error) throw error;
    revalidatePath(`/app/organisations/${input.organisationId}/my-shifts`);
    return null;
  });
}

export async function declineAssignmentAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("shifts.declineAssignment", async () => {
    const input = parseInput(assignmentActionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("decline_shift_assignment", {
      p_assignment_id: input.assignmentId,
    });
    if (error) throw error;
    revalidatePath(`/app/organisations/${input.organisationId}/my-shifts`);
    return null;
  });
}

// -----------------------------------------------------------------------------
// Facility: staffing requests
// -----------------------------------------------------------------------------
export async function submitFacilityRequestAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let created: { organisationId: string; shiftId: string } | null = null;
  const result = await runAction("shifts.submitFacilityRequest", async () => {
    const input = parseInput(facilityRequestSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("submit_facility_shift_request", {
      p_relationship_id: input.relationshipLocation.first,
      p_facility_location_id: input.relationshipLocation.second,
      ...scheduleRpcFields(input),
    });
    if (error) throw error;
    created = { organisationId: input.organisationId, shiftId: data };
    return null;
  });
  if (result.ok && created) {
    const { organisationId, shiftId } = created;
    redirect(requestsPath(organisationId, shiftId));
  }
  return result;
}

export async function withdrawFacilityRequestAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("shifts.withdrawFacilityRequest", async () => {
    const input = parseInput(shiftActionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("cancel_shift", {
      p_shift_id: input.shiftId,
      p_reason: "facility_cancelled",
    });
    if (error) throw error;
    revalidatePath(requestsPath(input.organisationId, input.shiftId));
    return null;
  });
}

// -----------------------------------------------------------------------------
// Offers (P0-E5-S2)
// -----------------------------------------------------------------------------
export type OfferSummary = { offered: number; skipped: number };

export async function offerShiftAction(
  _state: ActionState<OfferSummary>,
  formData: FormData,
): Promise<ActionState<OfferSummary>> {
  return runAction("shifts.offer", async () => {
    const input = parseInput(offerShiftSchema, {
      ...formDataToObject(formData),
      workerIds: formData.getAll("workerId").map(String),
    });
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("offer_shift_to_workers", {
      p_shift_id: input.shiftId,
      p_agency_worker_ids: input.workerIds,
      p_expires_in_minutes: input.expiresInMinutes,
    });
    if (error) throw error;
    revalidatePath(shiftPath(input.organisationId, input.shiftId));
    const offered = data.filter((row) => row.outcome === "offered").length;
    return { offered, skipped: data.length - offered };
  });
}

export async function cancelOfferAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("shifts.cancelOffer", async () => {
    const input = parseInput(agencyOfferActionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("cancel_shift_offer", { p_offer_id: input.offerId });
    if (error) throw error;
    revalidatePath(shiftPath(input.organisationId, input.shiftId));
    return null;
  });
}

/** The worker accepts: the server re-runs the full assignment gate. */
export async function acceptOfferAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("shifts.acceptOffer", async () => {
    const input = parseInput(offerActionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("accept_shift_offer", { p_offer_id: input.offerId });
    if (error) throw error;
    revalidatePath(`/app/organisations/${input.organisationId}/my-shifts`);
    const decision = data[0];
    if (decision?.outcome === "refused" && decision.primary_reason) {
      const typeNames = await listCredentialTypeNames();
      throw new AppError(ASSIGNMENT_BLOCK_ERROR[decision.primary_reason], {
        internalMessage: `offer acceptance refused: ${decision.block_reasons.join(",")}`,
        fieldErrors: {
          reasons: explainBlockReasons(
            decision.block_reasons,
            parseFindings(decision.compliance_findings),
            typeNames,
          ),
        },
      });
    }
    return null;
  });
}

export async function declineOfferAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("shifts.declineOffer", async () => {
    const input = parseInput(offerActionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("decline_shift_offer", { p_offer_id: input.offerId });
    if (error) throw error;
    revalidatePath(`/app/organisations/${input.organisationId}/my-shifts`);
    return null;
  });
}

export async function recheckReadinessAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("shifts.recheckReadiness", async () => {
    const input = parseInput(shiftActionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("recheck_shift_readiness", { p_shift_id: input.shiftId });
    if (error) throw error;
    revalidatePath(shiftPath(input.organisationId, input.shiftId));
    return null;
  });
}
