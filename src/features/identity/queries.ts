import "server-only";

import { cache } from "react";

import { requireAuthIdentity } from "@/lib/auth/session";
import type { TimezoneMode } from "@/lib/domain/display-timezone";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type MyProfile = {
  id: string;
  displayName: string | null;
  /** Personal presentation locale (P0-E9-3F); null ⇒ device / fallback. */
  locale: string | null;
  /** Personal DISPLAY timezone preference; never operational. */
  timezoneMode: TimezoneMode;
  timezone: string | null;
};

/** The caller's profile. Memoised per request. */
export const getMyProfile = cache(async (): Promise<MyProfile> => {
  const identity = await requireAuthIdentity();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, locale, timezone_mode, timezone")
    .eq("id", identity.userId)
    .single();
  if (error) throw error;
  return {
    id: data.id,
    displayName: data.display_name,
    locale: data.locale,
    timezoneMode: data.timezone_mode,
    timezone: data.timezone,
  };
});

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
