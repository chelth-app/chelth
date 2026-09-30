import type { Route } from "next";
import { redirect } from "next/navigation";

import { publicEnv } from "@/config/env.public";
import { getSafeRedirectPath } from "@/lib/security/safe-redirect";

/**
 * Redirects to a runtime-computed path after same-origin validation.
 *
 * Typed routes cannot type-check paths that are only known at runtime (e.g. a
 * validated `?next=` value). The single cast to `Route` lives here, and it is
 * sound because getSafeRedirectPath only returns same-origin absolute paths.
 */
export function redirectToSafePath(path: string | null | undefined, fallback = "/app"): never {
  redirect(getSafeRedirectPath(path, fallback) as Route);
}

/**
 * Redirects to an external URL that the server itself produced (e.g. a
 * Supabase Storage signed URL). Only the configured Supabase origin is
 * allowed, so this can never become an open redirect.
 */
export function redirectToExternalUrl(url: string): never {
  const target = new URL(url);
  if (target.origin !== new URL(publicEnv.NEXT_PUBLIC_SUPABASE_URL).origin) {
    throw new Error("Refusing to redirect outside the configured Supabase origin");
  }
  redirect(target.toString() as Route);
}
