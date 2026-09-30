import { z } from "zod";

import {
  TIMESHEET_DISPUTE_REASONS,
  TIMESHEET_REJECTION_REASONS,
  TIMESHEET_REOPEN_REASONS,
  TIMESHEET_STATUSES,
} from "@/lib/domain/timesheets";

const organisationId = z.uuid();
const timesheetId = z.uuid();
const revision = z.coerce.number().int().min(1).max(1000);
const optionalNote = z
  .string()
  .trim()
  .max(500, "Use at most 500 characters.")
  .optional()
  .transform((value) => (value ? value : undefined));

/** Timesheet commands carry ids and decisions only: never times or minutes. */
export const submitTimesheetSchema = z.object({ organisationId, timesheetId });

export const approveTimesheetSchema = z.object({ organisationId, timesheetId, revision });

export const rejectTimesheetSchema = z.object({
  organisationId,
  timesheetId,
  reason: z.enum(TIMESHEET_REJECTION_REASONS, { error: "Choose a reason." }),
  note: optionalNote,
});

export const reopenTimesheetSchema = z.object({
  organisationId,
  timesheetId,
  reason: z.enum(TIMESHEET_REOPEN_REASONS, { error: "Choose a reason." }),
  note: optionalNote,
});

export const rebuildTimesheetSchema = z.object({ organisationId, timesheetId });

export const facilityDecisionSchema = z
  .object({
    organisationId,
    entryId: z.uuid(),
    revision,
    decision: z.enum(["sign_off", "dispute"]),
    reason: z.enum(TIMESHEET_DISPUTE_REASONS).optional(),
    note: optionalNote,
  })
  .superRefine((value, ctx) => {
    if (value.decision === "dispute" && !value.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Choose what is wrong." });
    }
  });

export const resolveDisputeSchema = z.object({
  organisationId,
  timesheetId,
  entryId: z.uuid(),
  note: optionalNote,
});

export const weekStartSchema = z.object({
  organisationId,
  weekStartsOn: z.coerce.number().int().min(1).max(7),
});

export const timesheetFilterSchema = z.object({
  period: z.iso.date().optional().catch(undefined),
  status: z.enum(TIMESHEET_STATUSES).optional().catch(undefined),
});
