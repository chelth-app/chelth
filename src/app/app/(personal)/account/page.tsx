import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import {
  DisplayNameForm,
  getMyProfile,
  LocalePreference,
  TimezonePreference,
} from "@/features/identity";
import { requireAuthIdentity } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const [identity, profile] = await Promise.all([requireAuthIdentity(), getMyProfile()]);
  return (
    // Purposeful width (P0-E8-A1.3): left-aligned 760 px column, locked panel.
    <div className="chelth-locked flex w-full max-w-[760px] flex-col gap-6">
      <PageHeader
        variant="reference"
        title="Account"
        description={<p>Signed in as {identity.email}</p>}
      />
      <Panel
        titleId="profile-details-heading"
        title={<>Profile details</>}
        description={<>Manage the name shown across Chelth.</>}
      >
        <DisplayNameForm displayName={profile.displayName ?? ""} />
      </Panel>
      <Panel
        titleId="timezone-heading"
        title={<>Timezone</>}
        description={<>Detected from this device unless you choose one.</>}
      >
        <TimezonePreference preferences={profile} />
      </Panel>
      <Panel
        titleId="language-heading"
        title={<>Language</>}
        description={<>Spelling used on your personal pages.</>}
      >
        <LocalePreference preferences={profile} />
      </Panel>
    </div>
  );
}
