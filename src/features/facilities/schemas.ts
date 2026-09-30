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
