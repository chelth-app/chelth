import type { ReactNode } from "react";

import { DeviceTimezoneSync, getMyProfile } from "@/features/identity";
import { requireAuthIdentityOrRedirect } from "@/lib/auth/session";

/**
 * Authenticated area. The redirect here is UX only: every query is filtered
 * by RLS and every action re-checks identity and capability in the database.
 *
 * The visual frame is chosen below this layout (P0-E8-S1):
 * - (personal)/layout.tsx — /app, account, security: the personal frame;
 * - organisations/[organisationId]/(workspace)/layout.tsx — the shared
 *   Agency / Facility workspace shell;
 * - organisations/[organisationId]/(self-service)/layout.tsx — worker
 *   self-service pages: the personal frame, unchanged.
 * Route groups do not change any URL.
 *
 * P0-E9-3F: an AUTOMATIC personal display timezone follows the device here
 * (manual choices are never overwritten). Display only — no operational time.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireAuthIdentityOrRedirect("/app");
  const profile = await getMyProfile();
  return (
    <>
      <DeviceTimezoneSync timezoneMode={profile.timezoneMode} timezone={profile.timezone} />
      {children}
    </>
  );
}
