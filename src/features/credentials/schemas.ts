import { z } from "zod";

import {
  CREDENTIAL_TYPES,
  type DocumentMimeType,
  isAllowedDocumentMimeType,
  MAX_DOCUMENT_BYTES,
  REJECTION_REASONS,
  VERIFICATION_OUTCOMES,
} from "@/lib/domain/credentials";

const uuid = z.uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.");
const optionalDate = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined))
  .pipe(isoDate.optional());
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .regex(/^[^\p{Cc}]*$/u, "Remove unsupported characters.")
    .optional()
    .transform((value) => (value ? value : undefined));

export const createCredentialSchema = z.object({
  organisationId: uuid,
  credentialTypeKey: z.enum(CREDENTIAL_TYPES, { error: "Choose a credential type." }),
  jurisdictionCode: optionalText(10),
  issuingAuthority: optionalText(200),
  credentialNumber: optionalText(100),
  issueDate: optionalDate,
  expiryDate: optionalDate,
  shareWithAgency: z
    .string()
    .optional()
    .transform((value) => value === "on"),
});

export const newVersionSchema = z.object({
  organisationId: uuid,
  credentialId: uuid,
  issueDate: optionalDate,
  expiryDate: optionalDate,
});

export const versionActionSchema = z.object({
  organisationId: uuid,
  credentialId: uuid,
  versionId: uuid,
});
export const credentialActionSchema = z.object({ organisationId: uuid, credentialId: uuid });
export const revokeShareSchema = z.object({
  organisationId: uuid,
  credentialId: uuid,
  shareId: uuid,
});

export const startUploadSchema = z.object({
  versionId: uuid,
  fileName: z.string().min(1).max(255),
  mimeType: z.custom<DocumentMimeType>(
    (value) => typeof value === "string" && isAllowedDocumentMimeType(value),
    { error: "Upload a PDF, JPEG or PNG file." },
  ),
  sizeBytes: z.number().int().min(1).max(MAX_DOCUMENT_BYTES, "Files must be 10 MB or smaller."),
});

export const completeUploadSchema = z.object({ documentId: uuid });

export const recordVerificationSchema = z.object({
  organisationId: uuid,
  workerId: uuid,
  credentialId: uuid,
  versionId: uuid,
  outcome: z.enum(VERIFICATION_OUTCOMES),
  rejectionReason: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(z.enum(REJECTION_REASONS).optional()),
  facilityId: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(uuid.optional()),
});

export const openDocumentSchema = z.object({
  documentId: uuid,
  /** Absent for self-access; the reviewing agency otherwise. */
  organisationId: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(uuid.optional()),
});

export const credentialIdSchema = uuid;
