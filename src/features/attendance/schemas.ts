import { z } from "zod";

import {
  ATTENDANCE_CORRECTION_REASONS,
  ATTENDANCE_CORRECTION_RESOLUTIONS,
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

export const correctionRequestSchema = z.object({
  organisationId,
  assignmentId: z.uuid(),
  eventType: z.enum(["clock_in", "clock_out"], { error: "Choose clock-in or clock-out." }),
  date: z.iso.date({ error: "Choose a date." }),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a time."),
  timezone: z.string().min(1).max(64),
  reason: z.enum(ATTENDANCE_CORRECTION_REASONS, { error: "Choose a reason." }),
  note: z
    .string()
    .trim()
    .max(500, "Use at most 500 characters.")
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export const correctionReviewSchema = z.object({
  organisationId,
  correctionId: z.uuid(),
  decision: z.enum(["approve", "reject"]),
  resolution: z.enum(ATTENDANCE_CORRECTION_RESOLUTIONS, { error: "Choose a resolution." }),
});

export const exceptionReviewSchema = z.object({
  organisationId,
  exceptionId: z.uuid(),
  status: z.enum(["under_review", "resolved", "dismissed"]),
  resolution: z.enum(["acknowledged", "not_applicable"]).optional(),
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

export const geofenceSchema = z.object({
  organisationId,
  facilityId: z.uuid(),
  locationId: z.uuid(),
  enabled: z
    .string()
    .optional()
    .transform((value) => value === "on"),
  latitude: z.coerce.number({ error: "Enter a latitude." }).min(-90).max(90),
  longitude: z.coerce.number({ error: "Enter a longitude." }).min(-180).max(180),
  radiusMeters: z.coerce
    .number()
    .int()
    .min(GEOFENCE_RADIUS_BOUNDS.min, `At least ${GEOFENCE_RADIUS_BOUNDS.min} m.`)
    .max(GEOFENCE_RADIUS_BOUNDS.max, `At most ${GEOFENCE_RADIUS_BOUNDS.max} m.`),
  maxAccuracyMeters: z.coerce
    .number()
    .int()
    .min(GEOFENCE_ACCURACY_BOUNDS.min)
    .max(GEOFENCE_ACCURACY_BOUNDS.max),
  outsidePolicy: z.enum(GEOFENCE_OUTSIDE_POLICIES),
});

export const attendanceRangeSchema = z.object({
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
});
