import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { DisplayNameForm, getMyProfile } from "@/features/identity";
import { requireAuthIdentity } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const [identity, profile] = await Promise.all([requireAuthIdentity(), getMyProfile()]);
  return (
    <>
      <PageHeader
        title="Account"
        description={<p className="text-sm">Signed in as {identity.email}</p>}
      />
      <DisplayNameForm displayName={profile.displayName ?? ""} />
    </>
  );
}
