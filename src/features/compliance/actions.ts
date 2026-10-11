"use server";

import { revalidatePath } from "next/cache";

import { type ActionState, runAction } from "@/lib/actions/run-action";
import { requireAuthIdentity } from "@/lib/auth/session";
import type { CredentialCategory } from "@/lib/domain/credentials";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataToObject, parseInput } from "@/lib/validation";

import {
  complianceShareSchema,
  createCustomTypeSchema,
  createRequirementSchema,
  disciplineSchema,
  revokeComplianceShareSchema,
  setCustomTypeActiveSchema,
  updateCustomTypeSchema,
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

/* P0-E9-3J: agency-defined requirement types. Every rule is enforced by the RPCs. */

function revalidateCustomTypes(organisationId: string) {
  revalidatePath(`/app/organisations/${organisationId}/settings/compliance`);
  revalidatePath(`/app/organisations/${organisationId}/compliance`);
  revalidatePath(`/app/organisations/${organisationId}/facilities`, "layout");
}

function customTypeArgs(input: {
  name: string;
  category: CredentialCategory;
  requiresDocument: boolean;
  requiresExpiryDate: boolean;
  requiresVerification: boolean;
  requiresCredentialNumber: boolean;
  jurisdictionRule: "none" | "country" | "subdivision";
  validityMonths?: number | undefined;
  instructions?: string | undefined;
}) {
  return {
    p_name: input.name,
    p_category: input.category,
    p_requires_document: input.requiresDocument,
    p_requires_expiry_date: input.requiresExpiryDate,
    p_requires_verification: input.requiresVerification,
    p_requires_credential_number: input.requiresCredentialNumber,
    p_jurisdiction_rule: input.jurisdictionRule,
    ...(input.validityMonths ? { p_validity_months: input.validityMonths } : {}),
    ...(input.instructions ? { p_instructions: input.instructions } : {}),
  };
}

/** Returns the new type's key so the requirement form can preselect it. */
export async function createCustomTypeAction(
  _state: ActionState<{ key: string }>,
  formData: FormData,
): Promise<ActionState<{ key: string }>> {
  return runAction("compliance.createCustomType", async () => {
    const input = parseInput(createCustomTypeSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_custom_credential_type", {
      p_organisation_id: input.organisationId,
      ...customTypeArgs(input),
    });
    if (error) throw error;
    revalidateCustomTypes(input.organisationId);
    return { key: data };
  });
}

export async function updateCustomTypeAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("compliance.updateCustomType", async () => {
    const input = parseInput(updateCustomTypeSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("update_custom_credential_type", {
      p_key: input.key,
      ...customTypeArgs(input),
    });
    if (error) throw error;
    revalidateCustomTypes(input.organisationId);
    return null;
  });
}

export async function setCustomTypeActiveAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("compliance.setCustomTypeActive", async () => {
    const input = parseInput(setCustomTypeActiveSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_custom_credential_type_active", {
      p_key: input.key,
      p_active: input.active,
    });
    if (error) throw error;
    revalidateCustomTypes(input.organisationId);
    return null;
  });
}
