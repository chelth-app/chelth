/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Acts as the signed-in user (cookie session) with the anon key, so RLS
 * applies exactly as it would in the browser. Create a new client per request;
 * never cache or share one across requests.
 */
import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { publicEnv } from "@/config/env.public";
import type { Database } from "@/types/database.types";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. This is safe to ignore
            // because src/proxy.ts refreshes the session on every request.
          }
        },
      },
    },
  );
}
