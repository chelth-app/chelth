import { z } from "zod";

import { CREDENTIAL_TYPES, DISCIPLINES, REQUIREMENT_STATUSES } from "@/lib/domain/credentials";

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
  credentialTypeKey: z.enum(CREDENTIAL_TYPES, { error: "Choose a credential type." }),
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
