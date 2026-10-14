import { z } from "zod";

const uuid = z.uuid();
const noControl = /^[^\p{Cc}]*$/u;
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .regex(noControl, "Remove unsupported characters.")
    .optional()
    .transform((value) => (value ? value : undefined));
const optionalDate = z
  .union([z.literal(""), z.iso.date()])
  .optional()
  .transform((value) => (value ? value : undefined));
const reason = z
  .string()
  .trim()
  .min(3, "Give a reason (at least 3 characters).")
  .max(500, "Use at most 500 characters.")
  .regex(noControl, "Remove unsupported characters.");

export const createPlatformOrganisationSchema = z.object({
  type: z.enum(["agency", "facility"], { error: "Choose an organization type." }),
  name: z
    .string()
    .trim()
    .min(2, "Enter a name of at least 2 characters.")
    .max(120, "Use at most 120 characters.")
    .regex(noControl, "Remove unsupported characters."),
  ownerEmail: z.email({ error: "Enter a valid email address." }).max(254),
});

export const linkFacilitySchema = z.object({
  facilityOrganisationId: uuid,
  agencyFacilityId: z.uuid({ error: "Choose the agency's facility record." }),
  confirm: z.literal("on", { error: "Confirm the link." }),
});

export const platformInviteSchema = z.object({ organisationId: uuid, inviteId: uuid });

export const customerAccountSchema = z.object({
  organisationId: uuid,
  status: z.enum(["trial", "active", "past_due", "suspended", "cancelled"], {
    error: "Choose an account status.",
  }),
  planKey: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined)),
  billingName: optionalText(120),
  billingEmail: z
    .union([z.literal(""), z.email({ error: "Enter a valid email address." }).max(254)])
    .optional()
    .transform((value) => (value ? value : undefined)),
  trialEndsOn: optionalDate,
  currentPeriodEndsOn: optionalDate,
  cancelAtPeriodEnd: z
    .string()
    .optional()
    .transform((value) => value === "on"),
  reason,
});

export const lifecycleSchema = z.object({
  organisationId: uuid,
  status: z.enum(["active", "suspended"]),
  reason,
});

export const planSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,39}$/, "Use lowercase letters, digits and underscores."),
    name: z.string().trim().min(2, "Enter a plan name.").max(80),
    status: z.enum(["active", "retired"]),
    monthlyPrice: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value ? value : undefined))
      .pipe(
        z
          .string()
          .regex(/^\d{1,7}(\.\d{1,2})?$/, "Enter an amount such as 49 or 49.50.")
          .optional(),
      ),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .optional()
      .transform((value) => (value ? value : undefined))
      .pipe(
        z
          .string()
          .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code.")
          .optional(),
      ),
    includedSeats: z
      .string()
      .optional()
      .transform((value) => (value ? Number(value) : undefined))
      .pipe(z.number().int().min(0).max(100000).optional()),
    includedFacilities: z
      .string()
      .optional()
      .transform((value) => (value ? Number(value) : undefined))
      .pipe(z.number().int().min(0).max(100000).optional()),
  })
  .superRefine((value, ctx) => {
    if (Boolean(value.monthlyPrice) !== Boolean(value.currency)) {
      ctx.addIssue({
        code: "custom",
        path: [value.monthlyPrice ? "currency" : "monthlyPrice"],
        message: "Enter both a price and its currency, or neither.",
      });
    }
  });

export const fulfilBusinessSchema = z.object({
  requestId: uuid,
  status: z.enum(["trial", "active"], { error: "Choose trial or active." }),
  planKey: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined)),
  trialEndsOn: optionalDate,
  reason,
});
export const declineBusinessSchema = z.object({ requestId: uuid, reason });
