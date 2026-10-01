import { z } from "zod";

import {
  parseMajorToMinor,
  ROUNDING_INCREMENTS,
  SHIFT_CLASSIFICATIONS,
  SUPPORTED_CURRENCIES,
} from "@/lib/domain/pricing";

const organisationId = z.uuid();
const optionalUuid = z
  .union([z.literal(""), z.uuid()])
  .optional()
  .transform((value) => (value ? value : undefined));
const optionalDate = z
  .union([z.literal(""), z.iso.date()])
  .optional()
  .transform((value) => (value ? value : undefined));

/** A typed hourly amount → integer minor units (exact; > 0). */
const hourlyAmount = (label: string) =>
  z.string({ error: `Enter the ${label}.` }).transform((value, ctx) => {
    const minor = parseMajorToMinor(value);
    if (minor === null || minor < 1 || minor > 100_000_000) {
      ctx.addIssue({ code: "custom", message: `Enter the ${label} as an amount such as 42.50.` });
      return z.NEVER;
    }
    return minor;
  });

const versionTerms = {
  currency: z.enum(SUPPORTED_CURRENCIES, { error: "Choose a currency." }),
  payRate: hourlyAmount("pay rate"),
  billRate: hourlyAmount("bill rate"),
  effectiveFrom: z.iso.date({ error: "Choose a start date." }),
  effectiveTo: optionalDate,
};

function endAfterStart(
  value: { effectiveFrom: string; effectiveTo?: string | undefined },
  ctx: z.RefinementCtx,
) {
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    ctx.addIssue({
      code: "custom",
      path: ["effectiveTo"],
      message: "The end date must be on or after the start.",
    });
  }
}

/** New rate: a scope (card) and a draft version. Nothing is active until activated. */
export const newRateSchema = z
  .object({
    organisationId,
    relationshipId: optionalUuid,
    disciplineKey: z.string().min(1, "Choose a discipline.").max(60),
    classification: z
      .union([z.literal(""), z.enum(SHIFT_CLASSIFICATIONS)])
      .optional()
      .transform((value) => (value ? value : undefined)),
    ...versionTerms,
  })
  .superRefine(endAfterStart);

export const newVersionSchema = z
  .object({ organisationId, rateCardId: z.uuid(), ...versionTerms })
  .superRefine(endAfterStart);

export const versionActionSchema = z.object({ organisationId, versionId: z.uuid() });

export const roundingPolicySchema = z
  .object({
    organisationId,
    mode: z.enum(["none", "nearest"]),
    increment: z
      .union([z.literal(""), z.coerce.number().int()])
      .optional()
      .transform((value) => (value === "" || value === undefined ? undefined : value)),
    effectiveFrom: z.iso.date({ error: "Choose a start date." }),
  })
  .superRefine((value, ctx) => {
    if (
      value.mode === "nearest" &&
      !(ROUNDING_INCREMENTS as readonly number[]).includes(value.increment ?? -1)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["increment"],
        message: "Choose 5, 6, 10 or 15 minutes.",
      });
    }
  });

/** "37.5" hours → 2250 minutes; "1.5" → 15/10. Exact decimal parsing, no floats. */
function decimalParts(
  value: string,
  maxFraction: number,
): { digits: number; scale: number } | null {
  const match = new RegExp(`^(\\d{1,4})(?:\\.(\\d{1,${maxFraction}}))?$`).exec(value.trim());
  if (!match) return null;
  const fraction = match[2] ?? "";
  return { digits: Number(`${match[1]}${fraction}`), scale: 10 ** fraction.length };
}

export const overtimePolicySchema = z
  .object({
    organisationId,
    side: z.enum(["pay", "bill"]),
    mode: z.enum(["none", "weekly_threshold"]),
    thresholdHours: z.string().optional(),
    multiplier: z.string().optional(),
    effectiveFrom: z.iso.date({ error: "Choose a start date." }),
  })
  .transform((value, ctx) => {
    if (value.mode === "none") {
      return {
        ...value,
        thresholdMinutes: undefined,
        numerator: undefined,
        denominator: undefined,
      };
    }
    const hours = decimalParts(value.thresholdHours ?? "", 2);
    const multiplier = decimalParts(value.multiplier ?? "", 2);
    const minutes =
      hours && (hours.digits * 60) % hours.scale === 0 ? (hours.digits * 60) / hours.scale : null;
    if (minutes === null || minutes < 60 || minutes > 10_080) {
      ctx.addIssue({
        code: "custom",
        path: ["thresholdHours"],
        message: "Enter weekly hours such as 40.",
      });
    }
    if (!multiplier || multiplier.digits < multiplier.scale) {
      ctx.addIssue({
        code: "custom",
        path: ["multiplier"],
        message: "Enter a multiplier of at least 1, such as 1.5.",
      });
    }
    return {
      ...value,
      thresholdMinutes: minutes ?? undefined,
      numerator: multiplier?.digits,
      denominator: multiplier?.scale,
    };
  });

export const policyStatusSchema = z.object({
  organisationId,
  policyId: z.uuid(),
  status: z.enum(["active", "discarded"]),
});

/** Pricing names the locked revision it saw. It never carries minutes or amounts. */
export const priceTimesheetSchema = z.object({
  organisationId,
  timesheetId: z.uuid(),
  revision: z.coerce.number().int().min(1).max(1000),
});

export const shiftClassificationSchema = z.object({
  organisationId,
  shiftId: z.uuid(),
  classification: z.enum(SHIFT_CLASSIFICATIONS),
});

export const pricingQueueFilterSchema = z.object({
  state: z.enum(["attention", "ready", "priced"]).catch("attention"),
  after: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}_[0-9a-f-]{36}$/)
    .optional()
    .catch(undefined),
});

export const rateCardCursorSchema = z
  .string()
  .regex(/^[0-9TZ:.+-]{10,40}_[0-9a-f-]{36}$/)
  .optional()
  .catch(undefined);
