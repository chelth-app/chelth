import { z } from "zod";

export const threadIdSchema = z.uuid();

/** One message: trimmed, 1–2000 characters, newlines kept, other control characters refused. */
export const messageBodySchema = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, "\n").trim())
  .pipe(
    z
      .string()
      .min(1, "Write a message.")
      .max(2000, "Use at most 2000 characters.")
      .regex(/^[^\u0000-\u0009\u000b-\u001f\u007f]*$/, "Remove unsupported characters."),
  );

export const sendMessageSchema = z.object({
  organisationId: z.uuid(),
  threadId: threadIdSchema,
  body: messageBodySchema,
  // Generated once per composed message in the browser: retries reuse it.
  clientKey: z.uuid(),
});

/** Where the opened thread is shown: the worker app or the staff workspace. */
const surface = z.enum(["worker", "staff"]).default("staff");

export const openWorkerThreadSchema = z.object({
  surface,
  organisationId: z.uuid(),
  agencyWorkerId: z.uuid(),
  shiftId: z.uuid().optional(),
});

export const openFacilityThreadSchema = z.object({
  surface,
  organisationId: z.uuid(),
  relationshipId: z.uuid(),
  shiftId: z.uuid().optional(),
});
