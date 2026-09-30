/**
 * Session refresh for `src/proxy.ts`.
 *
 * Runs before rendering so expired access tokens are refreshed and the new
 * cookies are written to both the forwarded request (for Server Components in
 * this request) and the response (for the browser).
 *
 * This establishes WHO the user is. It does not decide WHAT they may do:
 * authorization is enforced by RLS and by checks inside each Server Action /
 * Route Handler, never by the proxy alone.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { publicEnv } from "@/config/env.public";
import type { Database } from "@/types/database.types";

export async function refreshSupabaseSession(
  request: NextRequest,
  requestHeaders: Headers,
): Promise<NextResponse> {
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          // Rebuild the forwarded headers so the refreshed cookies reach Server Components.
          requestHeaders.set("cookie", request.headers.get("cookie") ?? "");
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Cache-control headers supplied by @supabase/ssr stop CDNs caching auth cookies.
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    },
  );

  // getClaims() validates the JWT (signature/expiry) and triggers a refresh
  // when needed. Do not insert logic between client creation and this call.
  await supabase.auth.getClaims();

  return response;
}
