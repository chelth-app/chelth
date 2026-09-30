import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Email link types Chelth accepts at /auth/confirm. Magic-link and invite
 * flows are not enabled yet; add them here only when those flows are approved.
 */
export const ALLOWED_EMAIL_OTP_TYPES = [
  "signup",
  "email",
  "recovery",
  "email_change",
] as const satisfies readonly EmailOtpType[];

export type AllowedEmailOtpType = (typeof ALLOWED_EMAIL_OTP_TYPES)[number];

export function parseEmailOtpType(value: string | null): AllowedEmailOtpType | null {
  return (ALLOWED_EMAIL_OTP_TYPES as readonly string[]).includes(value ?? "")
    ? (value as AllowedEmailOtpType)
    : null;
}
