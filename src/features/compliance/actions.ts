"use server";

import { revalidatePath } from "next/cache";

import { type ActionState, runAction } from "@/lib/actions/run-action";
import { requireAuthIdentity } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataToObject, parseInput } from "@/lib/validation";

import {
  complianceShareSchema,
  createRequirementSchema,
  disciplineSchema,
  revokeComplianceShareSchema,
  updateRequirementSchema,
} from "./schemas";

function requirementsPath(organisationId: string, facilityId?: string) {
  return facilityId
    ? (`/app/organisations/${organisationId}/facilities/${facilityId}` as const)
    : (`/app/organisations/${organisationId}/compliance` as const);
}

export async function createRequirementAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("compliance.createRequirement", async () => {
    const input = parseInput(createRequirementSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("create_credential_requirement", {
      p_agency_organisation_id: input.organisationId,
      p_credential_type_key: input.credentialTypeKey,
      p_effective_from: input.effectiveFrom,
      ...(input.facilityId ? { p_agency_facility_id: input.facilityId } : {}),
      ...(input.disciplineKey ? { p_discipline_key: input.disciplineKey } : {}),
      p_must_be_verified: input.mustBeVerified,
      p_minimum_validity_days: input.minimumValidityDays,
      p_expiry_warning_days: input.expiryWarningDays,
      ...(input.jurisdictionCode ? { p_jurisdiction_code: input.jurisdictionCode } : {}),
    });
    if (error) throw error;
    revalidatePath(requirementsPath(input.organisationId, input.facilityId));
    return null;
  });
}

export async function updateRequirementAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("compliance.updateRequirement", async () => {
    const input = parseInput(updateRequirementSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("update_credential_requirement", {
      p_requirement_id: input.requirementId,
      p_must_be_verified: input.mustBeVerified,
      p_minimum_validity_days: input.minimumValidityDays,
      p_expiry_warning_days: input.expiryWarningDays,
      p_status: input.status,
      ...(input.effectiveUntil ? { p_effective_until: input.effectiveUntil } : {}),
    });
    if (error) throw error;
    revalidatePath(requirementsPath(input.organisationId, input.facilityId));
    return null;
  });
}

export async function setDisciplineAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("compliance.setDiscipline", async () => {
    const input = parseInput(disciplineSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_agency_worker_discipline", {
      p_agency_worker_id: input.workerId,
      p_discipline_key: input.disciplineKey,
      p_assigned: input.assigned,
    });
    if (error) throw error;
    revalidatePath(`/app/organisations/${input.organisationId}/workforce/${input.workerId}`);
    return null;
  });
}

export async function shareComplianceAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("compliance.share", async () => {
    const input = parseInput(complianceShareSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("share_worker_compliance", {
      p_relationship_id: input.relationshipId,
      p_agency_worker_id: input.workerId,
    });
    if (error) throw error;
    revalidatePath(`/app/organisations/${input.organisationId}/workforce/${input.workerId}`);
    return null;
  });
}

export async function revokeComplianceShareAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("compliance.revokeShare", async () => {
    const input = parseInput(revokeComplianceShareSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("revoke_worker_compliance_share", {
      p_share_id: input.shareId,
    });
    if (error) throw error;
    revalidatePath(`/app/organisations/${input.organisationId}/workforce/${input.workerId}`);
    return null;
  });
}
