import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { emailSchema, formDataToObject, parseInput, passwordSchema } from "@/lib/validation";

describe("parseInput", () => {
  const schema = z.object({ email: emailSchema, count: z.coerce.number().int().min(1) });

  it("returns parsed, normalised data", () => {
    expect(parseInput(schema, { email: "  Jane@Example.COM ", count: "3" })).toEqual({
      email: "jane@example.com",
      count: 3,
    });
  });

  it("throws VALIDATION_FAILED with field errors", () => {
    try {
      parseInput(schema, { email: "nope", count: 0 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe("VALIDATION_FAILED");
      expect(Object.keys(appError.fieldErrors ?? {})).toEqual(["email", "count"]);
    }
  });

  it("rejects unexpected shapes from the browser", () => {
    expect(() => parseInput(schema, "not an object")).toThrow(AppError);
  });
});

describe("passwordSchema", () => {
  it("enforces the policy mirrored in supabase/config.toml", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("alllowercase123").success).toBe(false);
    expect(passwordSchema.safeParse("Sufficiently1Long").success).toBe(true);
  });
});

describe("formDataToObject", () => {
  it("converts FormData entries", () => {
    const formData = new FormData();
    formData.set("email", "a@b.com");
    expect(formDataToObject(formData)).toEqual({ email: "a@b.com" });
  });
});
