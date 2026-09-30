import type { Route } from "next";
import { redirect } from "next/navigation";

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
