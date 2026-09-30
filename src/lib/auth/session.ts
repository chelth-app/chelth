/**
 * Authentication (identity) helpers for server code.
 *
 * Auth answers WHO the person is. It carries no roles, organisations or
 * permissions: authorization is evaluated by the database per organisation
 * (authz.has_capability) on every request — see
 * docs/architecture/AUTHORIZATION_MODEL.md.
 */
import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthIdentity = {
  userId: string;
  email: string | null;
  emailVerified: boolean;
};

export type AssuranceLevel = "aal1" | "aal2";

export type Assurance = {
  /** Assurance of the current session. */
  current: AssuranceLevel;
  /** Highest level this user can reach (aal2 once an authenticator is verified). */
  next: AssuranceLevel;
};

/**
 * Returns the verified identity for this request, or null when signed out.
 * Uses getUser(), which validates the session with the Auth server; never
 * trust getSession() on the server. Memoised per request.
 */
export const getAuthIdentity = cache(async (): Promise<AuthIdentity | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    emailVerified: data.user.email_confirmed_at != null,
  };
});

/** Returns the identity or throws AUTH_REQUIRED (for Server Actions). */
export async function requireAuthIdentity(): Promise<AuthIdentity> {
  const identity = await getAuthIdentity();
  if (!identity) throw new AppError("AUTH_REQUIRED");
  return identity;
}

/** Returns the identity or redirects to sign-in (for pages and layouts). */
export async function requireAuthIdentityOrRedirect(returnTo: string): Promise<AuthIdentity> {
  const identity = await getAuthIdentity();
  if (!identity) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  return identity;
}

/** Session assurance level (AAL). UI hint only — the database enforces AAL2. */
export const getAssurance = cache(async (): Promise<Assurance> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return {
    current: data?.currentLevel === "aal2" ? "aal2" : "aal1",
    next: data?.nextLevel === "aal2" ? "aal2" : "aal1",
  };
});
