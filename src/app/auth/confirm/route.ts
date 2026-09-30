/**
 * Email link verification (sign-up confirmation, password recovery, email
 * change). Supabase email templates link here with `token_hash` and `type`:
 *
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>&next=<path>
 *
 * The token is verified server-side and the session cookie is set. `next` is
 * restricted to same-origin paths to prevent open redirects.
 */
import { NextResponse, type NextRequest } from "next/server";

import { parseEmailOtpType } from "@/lib/auth/email-otp";
import { logger } from "@/lib/logging";
import { getSafeRedirectPath } from "@/lib/security/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = parseEmailOtpType(searchParams.get("type"));
  const next = getSafeRedirectPath(searchParams.get("next"));

  const errorUrl = new URL("/auth/error", request.url);

  if (!tokenHash || !type) {
    return NextResponse.redirect(errorUrl);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    logger.warn("Email link verification failed", { otpType: type, errorCode: error.code });
    return NextResponse.redirect(errorUrl);
  }

  return NextResponse.redirect(new URL(next, request.url));
}
