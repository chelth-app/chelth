/**
 * Request proxy (Next.js 16 replacement for middleware).
 *
 * Responsibilities — and only these:
 * 1. Generate a per-request CSP nonce and set the Content-Security-Policy.
 * 2. Refresh the Supabase auth session cookies.
 * 3. Pass the organisation id from the URL as a presentation hint
 *    (ORGANISATION_HINT_HEADER) so request-scoped terminology can follow the
 *    workspace's spelling. Never used for authorization: the organisation is
 *    re-read through RLS, and a client-sent value is always overwritten.
 *
 * It must not make authorization decisions. Server Actions and Route Handlers
 * verify identity and permissions themselves (a matcher change must never be
 * able to remove a security check).
 */
import type { NextRequest } from "next/server";

import { publicEnv } from "@/config/env.public";
import { isDevelopmentBuild } from "@/config/runtime";
import { buildContentSecurityPolicy } from "@/lib/security/csp";
import { ORGANISATION_HINT_HEADER, organisationIdFromPath } from "@/lib/i18n/organisation-hint";
import { generateNonce, NONCE_HEADER } from "@/lib/security/nonce";
import { refreshSupabaseSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    supabaseUrl: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    isDevelopment: isDevelopmentBuild,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  const organisationHint = organisationIdFromPath(request.nextUrl.pathname);
  if (organisationHint) requestHeaders.set(ORGANISATION_HINT_HEADER, organisationHint);
  else requestHeaders.delete(ORGANISATION_HINT_HEADER);

  const response = await refreshSupabaseSession(request, requestHeaders);
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: [
    {
      // Everything except API routes, static assets and image optimisation.
      source: "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
