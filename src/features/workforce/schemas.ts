import { z } from "zod";

import { WORKER_STATUSES } from "@/lib/domain/vocabulary";
import { emailSchema } from "@/lib/validation";

const organisationId = z.uuid();
const workerId = z.uuid();

export const workerIdSchema = workerId;

export const inviteWorkerSchema = z.object({ organisationId, email: emailSchema });

export const setWorkerStatusSchema = z.object({
  organisationId,
  workerId,
  status: z.enum(WORKER_STATUSES),
});

export const updateWorkerSchema = z.object({
  organisationId,
  workerId,
  workerReference: z
    .string()
    .trim()
    .max(50, "Use at most 50 characters.")
    .regex(/^[^\p{Cc}]*$/u, "Remove unsupported characters."),
});

export const addWorkerNoteSchema = z.object({
  organisationId,
  workerId,
  body: z.string().trim().min(1, "Write a note.").max(2000, "Use at most 2000 characters."),
});
