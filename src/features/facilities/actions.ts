"use server";

/**
 * Client facility, location and relationship Server Actions. Authorization,
 * lifecycle rules and audit live in the RPCs.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { type ActionState, runAction } from "@/lib/actions/run-action";
import { requireAuthIdentity } from "@/lib/auth/session";
import {
  FACILITY_IMAGE_BUCKET,
  facilityImagePath,
  imageMatchesType,
  MAX_FACILITY_IMAGE_BYTES,
} from "@/lib/domain/facility-images";
import { type ActionResult, AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataToObject, parseInput } from "@/lib/validation";

import {
  createFacilitySchema,
  createLocationSchema,
  createRelationshipSchema,
  facilityImageCompleteSchema,
  facilityImageRemoveSchema,
  facilityImageStartSchema,
  facilityStatusSchema,
  relationshipStatusSchema,
  updateFacilitySchema,
  workerContextSchema,
} from "./schemas";

function facilityPath(organisationId: string, facilityId?: string) {
  return facilityId
    ? (`/app/organisations/${organisationId}/facilities/${facilityId}` as const)
    : (`/app/organisations/${organisationId}/facilities` as const);
}

type FacilityFieldsInput = {
  name: string;
  facilityType: string;
  timezone: string;
  phone?: string | undefined;
  email?: string | undefined;
  addressLine1?: string | undefined;
  addressLine2?: string | undefined;
  locality?: string | undefined;
  region?: string | undefined;
  postalCode?: string | undefined;
  countryCode?: string | undefined;
  externalReference?: string | undefined;
};

function facilityRpcFields(input: FacilityFieldsInput) {
  return {
    p_name: input.name,
    p_facility_type: input.facilityType,
    p_timezone: input.timezone,
    ...(input.phone ? { p_phone: input.phone } : {}),
    ...(input.email ? { p_email: input.email } : {}),
    ...(input.addressLine1 ? { p_address_line1: input.addressLine1 } : {}),
    ...(input.addressLine2 ? { p_address_line2: input.addressLine2 } : {}),
    ...(input.locality ? { p_locality: input.locality } : {}),
    ...(input.region ? { p_region: input.region } : {}),
    ...(input.postalCode ? { p_postal_code: input.postalCode } : {}),
    ...(input.countryCode ? { p_country_code: input.countryCode } : {}),
    ...(input.externalReference ? { p_external_reference: input.externalReference } : {}),
  };
}

export async function createFacilityAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let created: { organisationId: string; facilityId: string } | null = null;
  const result = await runAction("facilities.create", async () => {
    const input = parseInput(createFacilitySchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_agency_facility", {
      p_agency_organisation_id: input.organisationId,
      ...facilityRpcFields(input),
    });
    if (error) throw error;
    created = { organisationId: input.organisationId, facilityId: data };
    return null;
  });
  if (result.ok && created) {
    const { organisationId, facilityId } = created;
    redirect(facilityPath(organisationId, facilityId));
  }
  return result;
}

export async function updateFacilityAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("facilities.update", async () => {
    const input = parseInput(updateFacilitySchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("update_agency_facility", {
      p_facility_id: input.facilityId,
      ...facilityRpcFields(input),
    });
    if (error) throw error;
    revalidatePath(facilityPath(input.organisationId, input.facilityId));
    return null;
  });
}

export async function setFacilityStatusAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("facilities.setStatus", async () => {
    const input = parseInput(facilityStatusSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_agency_facility_status", {
      p_facility_id: input.facilityId,
      p_status: input.status,
    });
    if (error) throw error;
    revalidatePath(facilityPath(input.organisationId, input.facilityId));
    return null;
  });
}

export async function createLocationAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("facilities.createLocation", async () => {
    const input = parseInput(createLocationSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("create_facility_location", {
      p_facility_id: input.facilityId,
      p_name: input.name,
      ...(input.timezone ? { p_timezone: input.timezone } : {}),
    });
    if (error) throw error;
    revalidatePath(facilityPath(input.organisationId, input.facilityId));
    return null;
  });
}

export async function createRelationshipAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("facilities.createRelationship", async () => {
    const input = parseInput(createRelationshipSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("create_facility_relationship", {
      p_facility_id: input.facilityId,
    });
    if (error) throw error;
    revalidatePath(facilityPath(input.organisationId, input.facilityId));
    return null;
  });
}

export async function setRelationshipStatusAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("facilities.setRelationshipStatus", async () => {
    const input = parseInput(relationshipStatusSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_facility_relationship_status", {
      p_relationship_id: input.relationshipId,
      p_status: input.status,
    });
    if (error) throw error;
    revalidatePath(facilityPath(input.organisationId, input.facilityId));
    return null;
  });
}

// -----------------------------------------------------------------------------
// Worker-facing context (P0-E9-3D-S2)
// -----------------------------------------------------------------------------

export async function updateWorkerContextAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("facilities.updateWorkerContext", async () => {
    const input = parseInput(workerContextSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("update_facility_worker_context", {
      p_facility_id: input.facilityId,
      p_parking_instructions: input.parkingInstructions ?? "",
      p_arrival_instructions: input.arrivalInstructions ?? "",
      p_worker_contact_label: input.workerContactLabel ?? "",
      p_worker_contact_phone: input.workerContactPhone ?? "",
    });
    if (error) throw error;
    revalidatePath(facilityPath(input.organisationId, input.facilityId));
    return null;
  });
}

/** One-time signed upload into the facility's own image prefix (Storage re-checks the policy). */
export async function startFacilityImageUploadAction(input: {
  organisationId: string;
  facilityId: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<ActionResult<{ path: string; token: string }>> {
  return runAction("facilities.startImageUpload", async () => {
    const parsed = parseInput(facilityImageStartSchema, input);
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const path = facilityImagePath(parsed.organisationId, parsed.facilityId, crypto.randomUUID());
    const signed = await supabase.storage.from(FACILITY_IMAGE_BUCKET).createSignedUploadUrl(path);
    if (signed.error) throw new AppError("FORBIDDEN", { internalMessage: "image upload refused" });
    return { path: signed.data.path, token: signed.data.token };
  });
}

/** Verifies the stored bytes, attaches the image and removes the one it replaces. */
export async function completeFacilityImageAction(input: {
  organisationId: string;
  facilityId: string;
  path: string;
  mimeType: string;
}): Promise<ActionResult<null>> {
  return runAction("facilities.completeImageUpload", async () => {
    const parsed = parseInput(facilityImageCompleteSchema, input);
    if (!parsed.path.startsWith(`${parsed.organisationId}/${parsed.facilityId}/`)) {
      throw new AppError("VALIDATION_FAILED", { internalMessage: "foreign image path" });
    }
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const bucket = supabase.storage.from(FACILITY_IMAGE_BUCKET);
    const download = await bucket.download(parsed.path);
    if (download.error) {
      throw new AppError("VALIDATION_FAILED", { internalMessage: "uploaded image missing" });
    }
    const bytes = new Uint8Array(await download.data.arrayBuffer());
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > MAX_FACILITY_IMAGE_BYTES ||
      !imageMatchesType(bytes, parsed.mimeType)
    ) {
      await bucket.remove([parsed.path]);
      throw new AppError("VALIDATION_FAILED", {
        internalMessage: "image content failed validation",
        fieldErrors: { image: ["This file is not a JPG or PNG image."] },
      });
    }
    const { data: previous, error } = await supabase.rpc("set_facility_image", {
      p_facility_id: parsed.facilityId,
      p_image_path: parsed.path,
    });
    if (error) {
      await bucket.remove([parsed.path]);
      throw error;
    }
    if (previous) await bucket.remove([previous]);
    revalidatePath(facilityPath(parsed.organisationId, parsed.facilityId));
    return null;
  });
}

export async function removeFacilityImageAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("facilities.removeImage", async () => {
    const input = parseInput(facilityImageRemoveSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data: previous, error } = await supabase.rpc("set_facility_image", {
      p_facility_id: input.facilityId,
    });
    if (error) throw error;
    if (previous) await supabase.storage.from(FACILITY_IMAGE_BUCKET).remove([previous]);
    revalidatePath(facilityPath(input.organisationId, input.facilityId));
    return null;
  });
}
