/**
 * Supabase client for the credential-document SCAN WORKER only
 * (src/app/api/internal/documents/scan). Not a privileged client:
 *
 * - anon key + the registered scanner principal's own session;
 * - that principal's application profile is suspended, so every application
 *   RPC and tenant policy refuses it; the database lets it claim / complete
 *   scans and read only the Storage objects it currently holds a claim on
 *   (internal.document_scanners, migration 20261009100000);
 * - the session lives in memory for one worker run (no cookies, no refresh).
 */
import "server-only";

import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/types/database.types";

export async function createScannerSessionClient(options: {
  supabaseUrl: string;
  anonKey: string;
  email: string;
  password: string;
}) {
  const jar = new Map<string, string>();
  const client = createServerClient<Database>(options.supabaseUrl, options.anonKey, {
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({
    email: options.email,
    password: options.password,
  });
  if (error) throw new Error("scanner sign-in failed");
  return client;
}
