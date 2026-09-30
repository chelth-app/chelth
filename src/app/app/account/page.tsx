import type { Metadata } from "next";

import { DisplayNameForm, getMyProfile } from "@/features/identity";
import { requireAuthIdentity } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const [identity, profile] = await Promise.all([requireAuthIdentity(), getMyProfile()]);
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Account</h1>
        <p className="text-sm text-muted-foreground">Signed in as {identity.email}</p>
      </header>
      <DisplayNameForm displayName={profile.displayName ?? ""} />
    </>
  );
}
