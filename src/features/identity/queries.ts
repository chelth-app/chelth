import "server-only";

import { requireAuthIdentity } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type MyProfile = { id: string; displayName: string | null };

export async function getMyProfile(): Promise<MyProfile> {
  const identity = await requireAuthIdentity();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("id", identity.userId)
    .single();
  if (error) throw error;
  return { id: data.id, displayName: data.display_name };
}

export type MfaFactorSummary = { id: string; friendlyName: string | null; createdAt: string };

export async function listMfaFactors(): Promise<MfaFactorSummary[]> {
  await requireAuthIdentity();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data.totp
    .filter((factor) => factor.status === "verified")
    .map((factor) => ({
      id: factor.id,
      friendlyName: factor.friendly_name ?? null,
      createdAt: factor.created_at,
    }));
}
