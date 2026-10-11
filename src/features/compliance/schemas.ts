import { z } from "zod";

import {
  CREDENTIAL_CATEGORIES,
  CREDENTIAL_TYPES,
  CUSTOM_CREDENTIAL_TYPE_KEY_PATTERN,
  DISCIPLINES,
  RENEWAL_INTERVAL_MONTHS,
  REQUIREMENT_STATUSES,
} from "@/lib/domain/credentials";

const uuid = z.uuid();
const optionalUuid = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined))
  .pipe(uuid.optional());

/** A calendar date exactly as entered (YYYY-MM-DD); never converted to an instant. */
const calendarDate = (message: string) => z.iso.date({ error: message });

export const createRequirementSchema = z.object({
  organisationId: uuid,
  effectiveFrom: calendarDate("Choose the date this requirement applies from."),
  facilityId: optionalUuid,
  credentialTypeKey: z.union(
    [z.enum(CREDENTIAL_TYPES), z.string().regex(CUSTOM_CREDENTIAL_TYPE_KEY_PATTERN)],
    { error: "Choose a credential type." },
  ),
  disciplineKey: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(z.enum(DISCIPLINES).optional()),
  mustBeVerified: z
    .string()
    .optional()
    .transform((value) => value === "on"),
  minimumValidityDays: z.coerce.number().int().min(0).max(730),
  expiryWarningDays: z.coerce.number().int().min(0).max(365),
  jurisdictionCode: z
    .string()
    .trim()
    .max(10)
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export const updateRequirementSchema = z
  .object({
    organisationId: uuid,
    facilityId: optionalUuid,
    requirementId: uuid,
    mustBeVerified: z.enum(["true", "false"]).transform((value) => value === "true"),
    minimumValidityDays: z.coerce.number().int().min(0).max(730),
    expiryWarningDays: z.coerce.number().int().min(0).max(365),
    status: z.enum(REQUIREMENT_STATUSES),
    effectiveUntil: z
      .union([z.literal(""), z.iso.date()])
      .optional()
      .transform((value) => (value ? value : undefined)),
  })
  .superRefine((value, ctx) => {
    if (value.status === "inactive" && !value.effectiveUntil) {
      ctx.addIssue({
        code: "custom",
        path: ["effectiveUntil"],
        message: "Choose the last day this requirement applies.",
      });
    }
  });

export const disciplineSchema = z.object({
  organisationId: uuid,
  workerId: uuid,
  disciplineKey: z.enum(DISCIPLINES),
  assigned: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const complianceShareSchema = z.object({
  organisationId: uuid,
  workerId: uuid,
  relationshipId: uuid,
});
export const revokeComplianceShareSchema = z.object({
  organisationId: uuid,
  workerId: uuid,
  shareId: uuid,
});

const checkbox = z
  .string()
  .optional()
  .transform((value) => value === "on");
const customKey = z.string().regex(CUSTOM_CREDENTIAL_TYPE_KEY_PATTERN);

/** P0-E9-3J: an agency-defined requirement type. The database re-validates every field. */
const customTypeFields = {
  organisationId: uuid,
  name: z
    .string()
    .trim()
    .min(2, "Enter a name of at least 2 characters.")
    .max(120, "Use at most 120 characters.")
    .regex(/^[^\p{Cc}]*$/u, "Remove unsupported characters."),
  category: z.enum(CREDENTIAL_CATEGORIES, { error: "Choose a category." }),
  requiresDocument: checkbox,
  requiresExpiryDate: checkbox,
  requiresVerification: checkbox,
  requiresCredentialNumber: checkbox,
  jurisdictionRule: z.enum(["none", "country", "subdivision"]).default("none"),
  validityMonths: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : undefined))
    .pipe(
      z
        .number()
        .int()
        .refine((value) => (RENEWAL_INTERVAL_MONTHS as readonly number[]).includes(value), {
          message: "Choose a renewal interval.",
        })
        .optional(),
    ),
  instructions: z
    .string()
    .trim()
    .max(1000, "Use at most 1000 characters.")
    // Line breaks and tabs are fine in instructions; other control characters are not.
    .regex(/^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/, "Remove unsupported characters.")
    .optional()
    .transform((value) => (value ? value : undefined)),
};

export const createCustomTypeSchema = z.object(customTypeFields);
export const updateCustomTypeSchema = z.object({ ...customTypeFields, key: customKey });
export const setCustomTypeActiveSchema = z.object({
  organisationId: uuid,
  key: customKey,
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});
