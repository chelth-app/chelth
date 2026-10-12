import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { StepUpNotice } from "@/features/organisations";
import { getMyProfile } from "@/features/identity";
import { getRequestTerminology, TerminologyProvider } from "@/features/localization";
import { getPlatformAccess } from "@/features/platform";
import { requireAuthIdentityOrRedirect } from "@/lib/auth/session";

import { PlatformFrame } from "./_components/platform-frame";

export const metadata: Metadata = {
  title: { default: "Platform", template: "%s · Platform · Chelth" },
};

/**
 * Platform control plane (P0-E9-4A). Exists only for an active platform
 * grant (404 for everyone else, like any route a person cannot use). The gate
 * here is presentation: every platform RPC re-checks the grant and AAL2 in
 * the database, and the grant confers no tenant authority.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const identity = await requireAuthIdentityOrRedirect("/platform");
  const access = await getPlatformAccess();
  if (access.kind === "none") notFound();
  const profile = await getMyProfile();
  return (
    <TerminologyProvider terms={await getRequestTerminology()}>
      <PlatformFrame
        operator={profile.displayName ?? identity.email ?? "Platform operator"}
        showNav={access.kind === "granted"}
      >
        {access.kind === "step_up" ? (
          <StepUpNotice returnTo="/platform">
            Platform administration requires verification with your authenticator app.
          </StepUpNotice>
        ) : (
          children
        )}
      </PlatformFrame>
    </TerminologyProvider>
  );
}
