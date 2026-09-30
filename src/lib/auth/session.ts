/**
 * Authentication (identity) helpers for server code.
 *
 * Auth answers WHO the person is. It deliberately carries no roles,
 * organisation or permissions: authorization (WHAT they may do) is designed in
 * P0-E3-S2 and enforced by RLS plus explicit server-side checks.
 */
import "server-only";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthIdentity = {
  userId: string;
  email: string | null;
  emailVerified: boolean;
};

/**
 * Returns the verified identity for this request, or null when signed out.
 * Uses getUser(), which validates the session with the Auth server; never
 * trust getSession() on the server.
 */
export async function getAuthIdentity(): Promise<AuthIdentity | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    emailVerified: data.user.email_confirmed_at != null,
  };
}

/** Returns the identity or throws AUTH_REQUIRED. */
export async function requireAuthIdentity(): Promise<AuthIdentity> {
  const identity = await getAuthIdentity();
  if (!identity) throw new AppError("AUTH_REQUIRED");
  return identity;
}
