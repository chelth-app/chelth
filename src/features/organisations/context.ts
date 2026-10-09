import "server-only";

import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

import { isDevelopmentBuild } from "@/config/runtime";

/**
 * Active-organisation context (UI preference ONLY).
 *
 * - Remembers which organisation the user last opened so /app can offer it
 *   first. It is never read by an action, query or RPC for authorization:
 *   every operation receives the organisation id explicitly and the database
 *   re-verifies membership and capability.
 * - There is no "first membership wins" fallback: with no valid preference,
 *   the user chooses.
 *
 * The invitation cookie carries a pending invite token between the emailed
 * link and sign-in/sign-up, so the token does not stay in the address bar.
 */
const ACTIVE_ORGANISATION_COOKIE = "chelth_active_org";
const INVITE_COOKIE = "chelth_invite";

const baseCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  // Browsers treat http://localhost as secure, so this also works for local E2E.
  secure: !isDevelopmentBuild,
};

export async function readActiveOrganisationPreference(): Promise<string | null> {
  const value = (await cookies()).get(ACTIVE_ORGANISATION_COOKIE)?.value;
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

/** Callable only from Server Actions / Route Handlers (cookie writes). */
export async function writeActiveOrganisationPreference(organisationId: string): Promise<void> {
  (await cookies()).set(ACTIVE_ORGANISATION_COOKIE, organisationId, {
    ...baseCookie,
    maxAge: 60 * 60 * 24 * 90,
  });
}

export async function readPendingInviteToken(): Promise<string | null> {
  return (await cookies()).get(INVITE_COOKIE)?.value ?? null;
}

/** Route Handler variant: the pending invitation token from the incoming request. */
export function pendingInviteTokenFrom(request: NextRequest): string | null {
  return request.cookies.get(INVITE_COOKIE)?.value ?? null;
}

/**
 * Stores a pending invitation token on a redirect response (Route Handler use).
 * 24 h, so the invitation survives sign-up and email confirmation in the same
 * browser; the token itself stays single-use, email-bound and time-limited.
 */
export function attachPendingInviteToken(response: NextResponse, token: string): void {
  response.cookies.set(INVITE_COOKIE, token, { ...baseCookie, maxAge: 60 * 60 * 24 });
}

export async function clearPendingInviteToken(): Promise<void> {
  (await cookies()).delete(INVITE_COOKIE);
}
