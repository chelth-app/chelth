"use server";

/**
 * Credential Server Actions: worker self-service (identity-scoped) and agency
 * verification (capability-scoped). The RPCs are the authority; these actions
 * validate input, perform the server-side upload checks, and mint short-lived
 * signed URLs only after the audited access gate says yes.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { type ActionState, runAction } from "@/lib/actions/run-action";
import { requireAuthIdentity } from "@/lib/auth/session";
import {
  contentMatchesMimeType,
  CREDENTIAL_DOCUMENT_BUCKET,
  type DocumentStatus,
  extensionMatchesMimeType,
  isAllowedDocumentMimeType,
  MAX_DOCUMENT_BYTES,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/domain/credentials";
import { AppError, type ActionResult } from "@/lib/errors";
import { redirectToExternalUrl } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataToObject, parseInput } from "@/lib/validation";

import {
  completeUploadSchema,
  createCredentialSchema,
  credentialActionSchema,
  newVersionSchema,
  openDocumentSchema,
  recordVerificationSchema,
  revokeShareSchema,
  startUploadSchema,
  versionActionSchema,
} from "./schemas";

function myCredentialPath(organisationId: string, credentialId?: string) {
  return credentialId
    ? (`/app/organisations/${organisationId}/my-credentials/${credentialId}` as const)
    : (`/app/organisations/${organisationId}/my-credentials` as const);
}

// -----------------------------------------------------------------------------
// Worker self-service
// -----------------------------------------------------------------------------

export async function createCredentialAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let created: { organisationId: string; credentialId: string } | null = null;
  const result = await runAction("credentials.create", async () => {
    const input = parseInput(createCredentialSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_credential", {
      p_credential_type_key: input.credentialTypeKey,
      ...(input.jurisdictionCode ? { p_jurisdiction_code: input.jurisdictionCode } : {}),
      ...(input.issuingAuthority ? { p_issuing_authority: input.issuingAuthority } : {}),
      ...(input.credentialNumber ? { p_credential_number: input.credentialNumber } : {}),
      ...(input.issueDate ? { p_issue_date: input.issueDate } : {}),
      ...(input.expiryDate ? { p_expiry_date: input.expiryDate } : {}),
    });
    if (error) throw error;
    const credentialId = data[0]?.credential_id;
    if (!credentialId)
      throw new AppError("INTERNAL", { internalMessage: "create_credential returned no row" });
    // Sharing is an explicit, separate consent — only when the worker ticked it.
    if (input.shareWithAgency) {
      const shared = await supabase.rpc("share_credential", {
        p_credential_id: credentialId,
        p_agency_organisation_id: input.organisationId,
      });
      if (shared.error) throw shared.error;
    }
    created = { organisationId: input.organisationId, credentialId };
    return null;
  });
  if (result.ok && created) {
    const { organisationId, credentialId } = created;
    redirect(myCredentialPath(organisationId, credentialId));
  }
  return result;
}

export async function createVersionAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("credentials.createVersion", async () => {
    const input = parseInput(newVersionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("create_credential_version", {
      p_credential_id: input.credentialId,
      ...(input.issueDate ? { p_issue_date: input.issueDate } : {}),
      ...(input.expiryDate ? { p_expiry_date: input.expiryDate } : {}),
    });
    if (error) throw error;
    revalidatePath(myCredentialPath(input.organisationId, input.credentialId));
    return null;
  });
}

export async function submitVersionAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("credentials.submitVersion", async () => {
    const input = parseInput(versionActionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("submit_credential_version", {
      p_credential_version_id: input.versionId,
    });
    if (error) throw error;
    revalidatePath(myCredentialPath(input.organisationId, input.credentialId));
    return null;
  });
}

export async function withdrawVersionAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("credentials.withdrawVersion", async () => {
    const input = parseInput(versionActionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("withdraw_credential_version", {
      p_credential_version_id: input.versionId,
    });
    if (error) throw error;
    revalidatePath(myCredentialPath(input.organisationId, input.credentialId));
    return null;
  });
}

export async function shareCredentialAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("credentials.share", async () => {
    const input = parseInput(credentialActionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("share_credential", {
      p_credential_id: input.credentialId,
      p_agency_organisation_id: input.organisationId,
    });
    if (error) throw error;
    revalidatePath(myCredentialPath(input.organisationId, input.credentialId));
    return null;
  });
}

export async function revokeShareAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("credentials.revokeShare", async () => {
    const input = parseInput(revokeShareSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("revoke_credential_share", { p_share_id: input.shareId });
    if (error) throw error;
    revalidatePath(myCredentialPath(input.organisationId, input.credentialId));
    return null;
  });
}

export async function withdrawCredentialAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("credentials.withdraw", async () => {
    const input = parseInput(credentialActionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("withdraw_credential", {
      p_credential_id: input.credentialId,
    });
    if (error) throw error;
    revalidatePath(myCredentialPath(input.organisationId, input.credentialId));
    return null;
  });
}

// -----------------------------------------------------------------------------
// Uploads: signed upload URL → browser uploads directly to private Storage →
// server verifies size, magic bytes and hash → document enters `scanning`.
// -----------------------------------------------------------------------------

export type UploadTicket = { documentId: string; path: string; token: string };

export async function startUploadAction(input: {
  versionId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<ActionResult<UploadTicket>> {
  return runAction("credentials.startUpload", async () => {
    const parsed = parseInput(startUploadSchema, input);
    if (!extensionMatchesMimeType(parsed.fileName, parsed.mimeType)) {
      throw new AppError("VALIDATION_FAILED", {
        internalMessage: "Extension does not match declared type",
        fieldErrors: { file: ["The file extension does not match its type."] },
      });
    }
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("begin_credential_document_upload", {
      p_credential_version_id: parsed.versionId,
      p_mime_type: parsed.mimeType,
      p_size_bytes: parsed.sizeBytes,
    });
    if (error) throw error;
    const ticket = data[0];
    if (!ticket)
      throw new AppError("INTERNAL", { internalMessage: "begin upload returned no row" });
    // Storage re-checks the upload policy (pending document owned by the caller).
    const signed = await supabase.storage
      .from(CREDENTIAL_DOCUMENT_BUCKET)
      .createSignedUploadUrl(ticket.object_path);
    if (signed.error)
      throw new AppError("INTERNAL", { internalMessage: "createSignedUploadUrl failed" });
    return { documentId: ticket.document_id, path: signed.data.path, token: signed.data.token };
  });
}

export async function completeUploadAction(input: {
  documentId: string;
}): Promise<ActionResult<DocumentStatus>> {
  return runAction("credentials.completeUpload", async () => {
    const { documentId } = parseInput(completeUploadSchema, input);
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();

    const { data: document, error } = await supabase
      .from("credential_documents")
      .select("storage_path, mime_type, declared_size_bytes, status")
      .eq("id", documentId)
      .maybeSingle();
    if (error) throw error;
    if (!document?.storage_path || !isAllowedDocumentMimeType(document.mime_type)) {
      throw new AppError("NOT_FOUND");
    }
    const storagePath = document.storage_path;

    // Server-side verification of what was actually stored — never trust the client.
    const download = await supabase.storage.from(CREDENTIAL_DOCUMENT_BUCKET).download(storagePath);
    if (download.error)
      throw new AppError("VALIDATION_FAILED", { internalMessage: "Uploaded object missing" });
    const bytes = new Uint8Array(await download.data.arrayBuffer());
    const valid =
      bytes.byteLength > 0 &&
      bytes.byteLength <= MAX_DOCUMENT_BYTES &&
      bytes.byteLength === document.declared_size_bytes &&
      contentMatchesMimeType(bytes, document.mime_type);
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");

    const { data: status, error: completeError } = await supabase.rpc(
      "complete_credential_document_upload",
      {
        p_document_id: documentId,
        p_sha256: digest,
        p_content_valid: valid,
      },
    );
    if (completeError) throw completeError;
    if (!valid) {
      // Remove the rejected bytes (the Storage policy only allows this for rejected uploads).
      await supabase.storage.from(CREDENTIAL_DOCUMENT_BUCKET).remove([storagePath]);
      throw new AppError("VALIDATION_FAILED", {
        internalMessage: "Uploaded content failed validation",
        fieldErrors: { file: ["The file content does not match a PDF, JPEG or PNG."] },
      });
    }
    return status;
  });
}

// -----------------------------------------------------------------------------
// Downloads: audited gate → 60 s signed URL → redirect. URL never stored/logged.
// -----------------------------------------------------------------------------

export async function openDocumentAction(formData: FormData): Promise<void> {
  const input = parseInput(openDocumentSchema, formDataToObject(formData));
  await requireAuthIdentity();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("authorize_credential_document_access", {
    p_document_id: input.documentId,
    ...(input.organisationId ? { p_organisation_id: input.organisationId } : {}),
  });
  if (error) throw error;
  const path = data[0]?.object_path;
  if (!path) throw new AppError("FORBIDDEN", { internalMessage: "Document access denied" });
  const signed = await supabase.storage
    .from(CREDENTIAL_DOCUMENT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signed.error)
    throw new AppError("FORBIDDEN", { internalMessage: "Storage refused signed URL" });
  redirectToExternalUrl(signed.data.signedUrl);
}

// -----------------------------------------------------------------------------
// Agency verification
// -----------------------------------------------------------------------------

export async function recordVerificationAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("credentials.recordVerification", async () => {
    const input = parseInput(recordVerificationSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("record_credential_verification", {
      p_credential_version_id: input.versionId,
      p_agency_organisation_id: input.organisationId,
      p_outcome: input.outcome,
      ...(input.rejectionReason ? { p_rejection_reason: input.rejectionReason } : {}),
      ...(input.facilityId ? { p_agency_facility_id: input.facilityId } : {}),
    });
    if (error) throw error;
    revalidatePath(
      `/app/organisations/${input.organisationId}/workforce/${input.workerId}/credentials/${input.credentialId}`,
    );
    return null;
  });
}
