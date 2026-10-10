import { z } from "zod";

import { FACILITY_STATUSES, FACILITY_TYPES, RELATIONSHIP_STATUSES } from "@/lib/domain/vocabulary";
import { emailSchema } from "@/lib/validation";

const organisationId = z.uuid();
const facilityId = z.uuid();

/** Optional form text: trimmed; empty string ⇒ absent. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .regex(/^[^\p{Cc}]*$/u, "Remove unsupported characters.")
    .optional()
    .transform((value) => (value ? value : undefined));
}

/** IANA timezone name. The database re-validates against its timezone catalogue. */
export const timezoneSchema = z
  .string()
  .trim()
  .regex(/^(UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+)$/, "Choose a valid timezone.")
  .max(64);

const facilityFields = {
  name: z
    .string()
    .trim()
    .min(2, "Use at least 2 characters.")
    .max(200, "Use at most 200 characters.")
    .regex(/^[^\p{Cc}]*$/u, "Remove unsupported characters."),
  facilityType: z.enum(FACILITY_TYPES, { error: "Choose a facility type." }),
  timezone: timezoneSchema,
  phone: optionalText(20).refine((value) => !value || /^\+?[0-9 ()-]{6,20}$/.test(value), {
    message: "Enter a valid phone number.",
  }),
  email: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(emailSchema.optional()),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  locality: optionalText(100),
  region: optionalText(100),
  postalCode: optionalText(20),
  countryCode: optionalText(2).refine((value) => !value || /^[A-Za-z]{2}$/.test(value), {
    message: "Use a two-letter country code.",
  }),
  externalReference: optionalText(100),
};

export const createFacilitySchema = z.object({ organisationId, ...facilityFields });
export const updateFacilitySchema = z.object({ organisationId, facilityId, ...facilityFields });

export const facilityStatusSchema = z.object({
  organisationId,
  facilityId,
  status: z.enum(FACILITY_STATUSES),
});

export const createLocationSchema = z.object({
  organisationId,
  facilityId,
  name: z.string().trim().min(1, "Enter a location name.").max(200),
  timezone: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(timezoneSchema.optional()),
});

export const createRelationshipSchema = z.object({ organisationId, facilityId });

export const relationshipStatusSchema = z.object({
  organisationId,
  facilityId,
  relationshipId: z.uuid(),
  status: z.enum(RELATIONSHIP_STATUSES),
});

export const facilityIdSchema = facilityId;

/** Optional multi-line text (newlines kept, other control characters refused). */
function optionalMultiline(max: number) {
  return z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .pipe(
      z
        .string()
        .max(max, `Use at most ${max} characters.`)
        .regex(/^[^\u0000-\u0009\u000b-\u001f\u007f]*$/, "Remove unsupported characters."),
    )
    .optional()
    .transform((value) => (value ? value : undefined));
}

/** Worker-facing arrival guidance and the opt-in role / desk contact (P0-E9-3D-S2). */
export const workerContextSchema = z
  .object({
    organisationId,
    facilityId,
    parkingInstructions: optionalMultiline(500),
    arrivalInstructions: optionalMultiline(500),
    workerContactLabel: optionalText(80).refine((value) => !value || value.length >= 2, {
      message: "Use at least 2 characters.",
    }),
    workerContactPhone: optionalText(20).refine(
      (value) => !value || /^\+?[0-9 ()-]{6,20}$/.test(value),
      { message: "Enter a valid phone number." },
    ),
  })
  .superRefine((value, context) => {
    if (Boolean(value.workerContactLabel) !== Boolean(value.workerContactPhone)) {
      context.addIssue({
        code: "custom",
        path: [value.workerContactLabel ? "workerContactPhone" : "workerContactLabel"],
        message: "Add both a contact name or desk and a phone number, or neither.",
      });
    }
  });

export const facilityImageStartSchema = z.object({
  organisationId,
  facilityId,
  mimeType: z.enum(["image/jpeg", "image/png"], { error: "Upload a JPG or PNG image." }),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(2 * 1024 * 1024, "Images must be 2 MB or smaller."),
});

export const facilityImageCompleteSchema = z.object({
  organisationId,
  facilityId,
  path: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/),
  mimeType: z.enum(["image/jpeg", "image/png"]),
});

export const facilityImageRemoveSchema = z.object({ organisationId, facilityId });
