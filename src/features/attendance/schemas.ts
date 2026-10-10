import { z } from "zod";

import {
  ATTENDANCE_ADJUSTMENT_REASONS,
  ATTENDANCE_CORRECTION_REASONS,
  ATTENDANCE_CORRECTION_RESOLUTIONS,
  CORRECTABLE_EVENT_TYPES,
  EVIDENCE_RETENTION_BOUNDS,
  GEOFENCE_ACCURACY_BOUNDS,
  GEOFENCE_OUTSIDE_POLICIES,
  GEOFENCE_RADIUS_BOUNDS,
} from "@/lib/domain/attendance";

const organisationId = z.uuid();

/** Optional number from a form field; empty ⇒ absent. */
function optionalNumber(min: number, max: number) {
  return z
    .union([z.literal(""), z.coerce.number().min(min).max(max)])
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : value));
}

/**
 * Clock actions carry NO time: the server records its own time. Coordinates
 * are sent only when the location requires them, after the user acts.
 */
export const clockSchema = z.object({
  organisationId,
  assignmentId: z.uuid(),
  latitude: optionalNumber(-90, 90),
  longitude: optionalNumber(-180, 180),
  accuracy: optionalNumber(0, 100_000),
  capturedAt: z.iso
    .datetime({ offset: true })
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

const optionalNote = z
  .string()
  .trim()
  .max(500, "Use at most 500 characters.")
  .optional()
  .transform((value) => (value ? value : undefined));

const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a time.");

/** Break number for break times (1 = first break); clock times always use 1. */
const breakNumber = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.coerce
    .number()
    .int()
    .min(1, "Breaks are numbered from 1.")
    .max(20, "At most 20 breaks.")
    .default(1),
);

/** Break actions carry no time and no location. */
export const breakSchema = z.object({ organisationId, assignmentId: z.uuid() });

export const correctionRequestSchema = z.object({
  organisationId,
  assignmentId: z.uuid(),
  eventType: z.enum(CORRECTABLE_EVENT_TYPES, { error: "Choose which time to correct." }),
  segment: breakNumber,
  date: z.iso.date({ error: "Choose a date." }),
  time: localTime,
  timezone: z.string().min(1).max(64),
  reason: z.enum(ATTENDANCE_CORRECTION_REASONS, { error: "Choose a reason." }),
  note: optionalNote,
});

export const correctionReviewSchema = z
  .object({
    organisationId,
    correctionId: z.uuid(),
    decision: z.enum(["approve", "reject", "adjust"]),
    resolution: z
      .enum(ATTENDANCE_CORRECTION_RESOLUTIONS, { error: "Choose a resolution." })
      .optional(),
    /** Adjusted approval: a different local time, a reason and an optional note. */
    date: z.iso
      .date()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    time: localTime.optional().or(z.literal("").transform(() => undefined)),
    timezone: z.string().min(1).max(64).optional(),
    adjustmentReason: z
      .enum(ATTENDANCE_ADJUSTMENT_REASONS, { error: "Choose a reason for the adjustment." })
      .optional(),
    note: optionalNote,
    confirmRevision: z
      .string()
      .optional()
      .transform((value) => value === "on"),
  })
  .superRefine((value, ctx) => {
    if (value.decision === "adjust") {
      if (!value.date) ctx.addIssue({ code: "custom", path: ["date"], message: "Choose a date." });
      if (!value.time) ctx.addIssue({ code: "custom", path: ["time"], message: "Choose a time." });
      if (!value.adjustmentReason)
        ctx.addIssue({
          code: "custom",
          path: ["adjustmentReason"],
          message: "Choose a reason for the adjustment.",
        });
    }
    if (value.decision === "reject" && !value.resolution)
      ctx.addIssue({ code: "custom", path: ["resolution"], message: "Choose a resolution." });
  });

/** Reviewer-originated adjustment (e.g. after a facility discrepancy). */
export const attendanceAdjustmentSchema = z.object({
  organisationId,
  attendanceId: z.uuid(),
  eventType: z.enum(CORRECTABLE_EVENT_TYPES, { error: "Choose which time to adjust." }),
  segment: breakNumber,
  date: z.iso.date({ error: "Choose a date." }),
  time: localTime,
  timezone: z.string().min(1).max(64),
  adjustmentReason: z.enum(ATTENDANCE_ADJUSTMENT_REASONS, { error: "Choose a reason." }),
  note: optionalNote,
  confirmRevision: z
    .string()
    .optional()
    .transform((value) => value === "on"),
});

export const legalHoldSchema = z.object({
  organisationId,
  attendanceId: z.uuid(),
  reason: z
    .string()
    .trim()
    .min(3, "Describe the reason (at least 3 characters).")
    .max(300, "Use at most 300 characters."),
});

export const releaseHoldSchema = z.object({
  organisationId,
  attendanceId: z.uuid(),
  holdId: z.uuid(),
});

export const retentionSchema = z.object({
  organisationId,
  retentionDays: z.coerce
    .number({ error: "Enter a number of days." })
    .int()
    .min(EVIDENCE_RETENTION_BOUNDS.min, `At least ${EVIDENCE_RETENTION_BOUNDS.min} days.`)
    .max(EVIDENCE_RETENTION_BOUNDS.max, `At most ${EVIDENCE_RETENTION_BOUNDS.max} days.`),
});

export const exceptionReviewSchema = z.object({
  organisationId,
  exceptionId: z.uuid(),
  status: z.enum(["under_review", "resolved", "dismissed"]),
  resolution: z.enum(["acknowledged", "not_applicable", "not_worked"]).optional(),
  attendanceId: z.uuid().optional(),
});

export const attendanceSettingsSchema = z.object({
  organisationId,
  earlyClockInMinutes: z.coerce.number().int().min(0).max(240),
  lateClockInMinutes: z.coerce.number().int().min(0).max(120),
  earlyClockOutMinutes: z.coerce.number().int().min(0).max(240),
  lateClockOutMinutes: z.coerce.number().int().min(0).max(240),
  missedClockInMinutes: z.coerce.number().int().min(5).max(240),
  missedClockOutMinutes: z.coerce.number().int().min(15).max(720),
  clockOutCutoffMinutes: z.coerce.number().int().min(60).max(1440),
});

/** Whole metres within bounds; a blank, zero, negative or non-numeric value is rejected. */
function wholeMetres(bounds: { min: number; max: number }) {
  return z.coerce
    .number({ error: "Enter a number of metres." })
    .int("Enter whole metres.")
    .min(bounds.min, `At least ${bounds.min} m.`)
    .max(bounds.max, `At most ${bounds.max} m.`);
}
const radiusMeters = wholeMetres(GEOFENCE_RADIUS_BOUNDS);
const maxAccuracyMeters = wholeMetres(GEOFENCE_ACCURACY_BOUNDS);

/** A required decimal-degree coordinate. Blank is "missing", never 0°. */
function coordinate(missing: string, min: number, max: number) {
  return z
    .string({ error: missing })
    .trim()
    .min(1, missing)
    .transform(Number)
    .pipe(
      z
        .number({ error: "Enter decimal degrees, e.g. 41.8781." })
        .min(min, `Between ${min} and ${max}.`)
        .max(max, `Between ${min} and ${max}.`),
    );
}

export const geofenceSchema = z.object({
  organisationId,
  facilityId: z.uuid(),
  locationId: z.uuid(),
  enabled: z
    .string()
    .optional()
    .transform((value) => value === "on"),
  latitude: coordinate("Enter the site latitude.", -90, 90),
  longitude: coordinate("Enter the site longitude.", -180, 180),
  radiusMeters,
  maxAccuracyMeters,
  outsidePolicy: z.enum(GEOFENCE_OUTSIDE_POLICIES),
});

export const geofencePolicySchema = z.object({
  organisationId,
  requireGeofence: z
    .string()
    .optional()
    .transform((value) => value === "on"),
  defaultRadiusMeters: radiusMeters,
  defaultMaxAccuracyMeters: maxAccuracyMeters,
  defaultOutsidePolicy: z.enum(GEOFENCE_OUTSIDE_POLICIES),
});

export const attendanceRangeSchema = z.object({
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
});
