import { z } from "zod";

import { isValidTimeZone } from "@/lib/domain/display-timezone";
import { SUPPORTED_LOCALES } from "@/lib/i18n/terminology";

import { emailSchema, passwordSchema } from "@/lib/validation";

const nextPathSchema = z.string().max(2048).optional();

export const signInSchema = z.object({
  email: emailSchema,
  // Sign-in does not re-apply the password policy: that would leak policy
  // changes and block legacy passwords. Only bound the size.
  password: z.string().min(1, "Enter your password.").max(128),
  next: nextPathSchema,
});

export const signUpSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(120, "Use at most 120 characters.")
    .regex(/^[^\p{Cc}]*$/u, "Remove unsupported characters."),
  email: emailSchema,
  password: passwordSchema,
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export const totpCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."),
  next: nextPathSchema,
});

export const totpEnrollmentVerifySchema = totpCodeSchema.extend({
  factorId: z.uuid(),
});

export const displayNameSchema = signUpSchema.pick({ displayName: true });

/** Personal display preferences (P0-E9-3F). The database re-validates the zone. */
export const displayPreferencesSchema = z
  .object({
    locale: z
      .enum(["", ...SUPPORTED_LOCALES])
      .optional()
      .transform((value) => (value ? value : null)),
    timezoneMode: z.enum(["automatic", "manual"]),
    timezone: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value ? value : null)),
  })
  .superRefine((input, context) => {
    if (input.timezone !== null && !isValidTimeZone(input.timezone)) {
      context.addIssue({
        code: "custom",
        path: ["timezone"],
        message: "Choose a timezone from the list, e.g. Europe/London.",
      });
    }
    if (input.timezoneMode === "manual" && input.timezone === null) {
      context.addIssue({ code: "custom", path: ["timezone"], message: "Choose a timezone." });
    }
  });
