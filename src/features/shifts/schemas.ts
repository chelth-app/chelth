import { z } from "zod";

import {
  ASSIGNMENT_CANCELLATION_REASONS,
  MAX_REQUESTED_HEADCOUNT,
  SHIFT_CANCELLATION_REASONS,
  SHIFT_STATUSES,
} from "@/lib/domain/shifts";

const organisationId = z.uuid();
const shiftId = z.uuid();

export const shiftIdSchema = shiftId;

/** Optional form text: trimmed; empty string ⇒ absent. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .optional()
    .transform((value) => (value ? value : undefined));
}

const localDate = z.iso.date({ error: "Choose a date." });
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a time.");

/**
 * Wall-clock times in the LOCATION's timezone. An end time at or before the
 * start time means the shift ends the next day (overnight); the database
 * converts to canonical instants and rejects times that do not exist (DST).
 */
const scheduleFields = {
  disciplineKey: z.string().regex(/^[a-z][a-z0-9_]*$/, "Choose a discipline."),
  shiftDate: localDate,
  startTime: localTime,
  endTime: localTime,
  requestedHeadcount: z.coerce
    .number({ error: "Enter how many workers are needed." })
    .int("Enter a whole number.")
    .min(1, "At least 1 worker.")
    .max(MAX_REQUESTED_HEADCOUNT, `At most ${MAX_REQUESTED_HEADCOUNT} workers.`),
  instructions: optionalText(2000),
  externalReference: optionalText(100).refine((value) => !value || !/\p{Cc}/u.test(value), {
    message: "Remove unsupported characters.",
  }),
};

/** "<uuid>:<uuid>" from a combined two-level picker (no client-side JS needed). */
function idPair(message: string) {
  return z
    .string({ error: message })
    .regex(/^[0-9a-f-]{36}:[0-9a-f-]{36}$/i, message)
    .transform((value) => {
      const [first = "", second = ""] = value.split(":");
      return { first, second };
    })
    .pipe(z.object({ first: z.uuid(), second: z.uuid() }));
}

/** facilityId:locationId */
const facilityLocation = idPair("Choose a facility location.");
/** relationshipId:locationId */
const relationshipLocation = idPair("Choose an agency and location.");

export const createShiftSchema = z.object({
  organisationId,
  facilityLocation,
  ...scheduleFields,
  open: z
    .string()
    .optional()
    .transform((value) => value === "on"),
});

export const facilityRequestSchema = z.object({
  organisationId,
  relationshipLocation,
  ...scheduleFields,
});

export const shiftActionSchema = z.object({ organisationId, shiftId });

export const cancelShiftSchema = z.object({
  organisationId,
  shiftId,
  reason: z.enum(SHIFT_CANCELLATION_REASONS, { error: "Choose a reason." }),
});

export const updateShiftDetailsSchema = z.object({
  organisationId,
  shiftId,
  requestedHeadcount: scheduleFields.requestedHeadcount,
  instructions: scheduleFields.instructions,
  externalReference: scheduleFields.externalReference,
});

export const shiftNoteSchema = z.object({
  organisationId,
  shiftId,
  body: z.string().trim().min(1, "Write a note.").max(2000, "Use at most 2000 characters."),
});

export const assignWorkerSchema = z.object({ organisationId, shiftId, workerId: z.uuid() });

export const assignmentActionSchema = z.object({
  organisationId,
  assignmentId: z.uuid(),
});

export const cancelAssignmentSchema = z.object({
  organisationId,
  shiftId,
  assignmentId: z.uuid(),
  reason: z.enum(ASSIGNMENT_CANCELLATION_REASONS, { error: "Choose a reason." }),
});

/** Shift list filters (URL search params). Invalid values are ignored. */
export const shiftFiltersSchema = z.object({
  status: z.enum(SHIFT_STATUSES).optional().catch(undefined),
  facilityId: z.uuid().optional().catch(undefined),
  from: localDate.optional().catch(undefined),
  to: localDate.optional().catch(undefined),
});

export type ShiftFilters = z.infer<typeof shiftFiltersSchema>;
