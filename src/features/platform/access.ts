import "server-only";

import { cache } from "react";

import { getAssurance, getAuthIdentity } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PlatformAccess =
  /** No active platform grant: /platform does not exist for this person. */
  | { kind: "none" }
  /** Active grant, but the session is not AAL2 yet: step up first. */
  | { kind: "step_up" }
  /** Active grant at AAL2: platform RPCs will authorise. */
  | { kind: "granted" };

/**
 * P0-E9-4A: whether the signed-in person holds an active platform grant.
 * Presentation only. Reads the caller's OWN grant row (RLS: own rows only);
 * every platform RPC re-checks the grant and AAL2 in the database. A grant
 * never confers tenant membership or tenant capabilities.
 */
export const getPlatformAccess = cache(async (): Promise<PlatformAccess> => {
  const identity = await getAuthIdentity();
  if (!identity) return { kind: "none" };
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("platform_admins")
    .select("id")
    .eq("profile_id", identity.userId)
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return { kind: "none" };
  const assurance = await getAssurance();
  return assurance.current === "aal2" ? { kind: "granted" } : { kind: "step_up" };
});
