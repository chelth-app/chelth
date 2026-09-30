import { z } from "zod";

import { AppError } from "@/lib/errors";

/**
 * Validates untrusted input (form data, action arguments, route params,
 * external API responses). Throws a VALIDATION_FAILED AppError with per-field
 * messages. Never trust a browser-provided object without passing it through
 * a schema first.
 */
export function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const flattened = z.flattenError(result.error);
  const fieldErrors: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(flattened.fieldErrors)) {
    if (Array.isArray(messages) && messages.length > 0) fieldErrors[field] = messages as string[];
  }
  if (flattened.formErrors.length > 0) fieldErrors._form = flattened.formErrors;

  throw new AppError("VALIDATION_FAILED", {
    internalMessage: "Input validation failed",
    fieldErrors,
    context: { fields: Object.keys(fieldErrors) },
  });
}

/** Converts FormData to a plain object for schema validation (last value wins). */
export function formDataToObject(formData: FormData): Record<string, FormDataEntryValue> {
  const output: Record<string, FormDataEntryValue> = {};
  formData.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}
