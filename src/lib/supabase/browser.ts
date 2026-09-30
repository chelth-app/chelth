/**
 * Supabase client for Client Components (browser).
 *
 * Uses only the public anon/publishable key. Every query it makes is subject
 * to Row Level Security as the signed-in user — it can never do more than
 * that user is allowed to do. `client-only` makes importing this from server
 * code a build error.
 */
import "client-only";

import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/config/env.public";
import type { Database } from "@/types/database.types";

export function createSupabaseBrowserClient() {
  // createBrowserClient memoises a single instance per page in the browser.
  return createBrowserClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
