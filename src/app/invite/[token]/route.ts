/**
 * Invitation link entry point: /invite/<token>
 *
 * Moves the token out of the address bar into a short-lived httpOnly cookie
 * and redirects to /invite. The response is identical for every token (no
 * pre-authentication validity oracle); validity is evaluated only after
 * sign-in, throttled per identity, by the database.
 */
import { NextResponse, type NextRequest } from "next/server";

import { attachPendingInviteToken, isInviteTokenFormat } from "@/features/organisations";

export async function GET(request: NextRequest, { params }: RouteContext<"/invite/[token]">) {
  const { token } = await params;
  const response = NextResponse.redirect(new URL("/invite", request.url), { status: 303 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  // Malformed tokens are silently dropped: the next page looks the same either way.
  if (isInviteTokenFormat(token)) attachPendingInviteToken(response, token);
  return response;
}
