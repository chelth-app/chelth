import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";

import type { Database } from "@/types/database.types";

import { waitForEmailLink, uniqueEmail } from "../../support/mailpit";
import { generateTotp } from "../../support/totp";
import { SUPABASE_ANON_KEY, SUPABASE_DB_URL, SUPABASE_URL } from "./env";

export type TestClient = SupabaseClient<Database>;

export type TestIdentity = {
  client: TestClient;
  userId: string;
  email: string;
  displayName: string;
  totpSecret?: string;
};

export const PASSWORD = "Integration-Test-Passw0rd";

export function anonClient(): TestClient {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Real sign-up through the public Auth API, confirmed through the real email
 * link captured by local Mailpit. No service-role key is involved.
 */
export async function signUpVerified(
  label: string,
  email = uniqueEmail(label),
): Promise<TestIdentity> {
  const client = anonClient();
  const displayName = `${label} tester`;
  const { error } = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: { data: { display_name: displayName } },
  });
  if (error) throw error;

  const link = await waitForEmailLink(email, "Confirm your CHELTH account");
  const tokenHash = link.searchParams.get("token_hash");
  if (!tokenHash) throw new Error("Confirmation link has no token_hash");
  const { data, error: verifyError } = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: "email",
  });
  if (verifyError || !data.user) throw verifyError ?? new Error("verifyOtp returned no user");

  return { client, userId: data.user.id, email, displayName };
}

/** Enrols TOTP and raises the session to AAL2. */
export async function stepUpToAal2(identity: TestIdentity): Promise<void> {
  const { client } = identity;
  if (!identity.totpSecret) {
    const { data, error } = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "integration",
    });
    if (error) throw error;
    identity.totpSecret = data.totp.secret;
    const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
      factorId: data.id,
      code: generateTotp(data.totp.secret),
    });
    if (verifyError) throw verifyError;
    return;
  }
  const { data: factors, error } = await client.auth.mfa.listFactors();
  if (error) throw error;
  const factor = factors.totp[0];
  if (!factor) throw new Error("No TOTP factor");
  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: generateTotp(identity.totpSecret),
  });
  if (verifyError) throw verifyError;
}

/** Operator procedure (database owner, local only): grant platform admin. */
export async function grantPlatformAdmin(profileId: string): Promise<void> {
  const sql = postgres(SUPABASE_DB_URL, { max: 1 });
  try {
    await sql`select internal.grant_platform_admin(${profileId}::uuid, 'Integration Test Operator', 'integration test fixture')`;
  } finally {
    await sql.end();
  }
}

export async function ownerQuery<T extends readonly object[]>(
  query: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  const sql = postgres(SUPABASE_DB_URL, { max: 1 });
  try {
    return await query(sql);
  } finally {
    await sql.end();
  }
}

export function slug(label: string): string {
  return `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
