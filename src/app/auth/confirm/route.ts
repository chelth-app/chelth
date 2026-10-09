/**
 * Email link verification (sign-up confirmation, password recovery, email
 * change). Supabase email templates link here with `token_hash` and `type`:
 *
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>&next=<path>
 *
 * The token is verified server-side and the session cookie is set. `next` is
 * restricted to same-origin paths to prevent open redirects.
 *
 * Hosted Supabase must use the templates in supabase/templates/. The default
 * Supabase templates ({{ .ConfirmationURL }}) bypass this route entirely and
 * land on the Site URL root — see docs/reports/P0-E3-S2B-password-recovery-hosted-fix.txt.
 */
import { NextResponse, type NextRequest } from "next/server";

import { isInviteTokenFormat, pendingInviteTokenFrom } from "@/features/organisations";
import { parseEmailOtpType } from "@/lib/auth/email-otp";
import { logger } from "@/lib/logging";
import { getSafeRedirectPath } from "@/lib/security/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** A recovery session has one purpose: choosing a new password. */
const RECOVERY_DESTINATION = "/reset-password";
/** After any other verification the user is signed in, so land in the app. */
const DEFAULT_DESTINATION = "/app";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = parseEmailOtpType(searchParams.get("type"));

  const errorUrl = new URL("/auth/error", request.url);

  if (!tokenHash || !type) {
    return NextResponse.redirect(errorUrl);
  }

  // Recovery ignores `next`: the destination does not depend on the hosted
  // email template carrying it, and a recovery session cannot be redirected
  // anywhere else.
  const next =
    type === "recovery"
      ? RECOVERY_DESTINATION
      : getSafeRedirectPath(searchParams.get("next"), DEFAULT_DESTINATION);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    logger.warn("Email link verification failed", { otpType: type, errorCode: error.code });
    return NextResponse.redirect(errorUrl);
  }

  // A newly confirmed invitee resumes their invitation instead of landing on
  // the generic gateway (the token stays in its httpOnly cookie).
  if (type !== "recovery" && next === DEFAULT_DESTINATION) {
    if (isInviteTokenFormat(pendingInviteTokenFrom(request))) {
      return NextResponse.redirect(new URL("/invite", request.url));
    }
  }

  return NextResponse.redirect(new URL(next, request.url));
}
