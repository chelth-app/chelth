import { redirect } from "next/navigation";

import { getAuthIdentity } from "@/lib/auth/session";

/**
 * App entry (P0-E8-A1.1). The application domain is the product, not a
 * landing page: signed-out visitors go to Sign in; signed-in users go to the
 * existing app entry (/app — the workspace chooser, which applies its own
 * routing). Uses the same identity helper as the sign-in page; invite
 * (/invite) and recovery (/auth/confirm → /reset-password) links never pass
 * through here, and safe `next` handling stays on /sign-in.
 */
export default async function HomePage() {
  redirect((await getAuthIdentity()) ? "/app" : "/sign-in");
}
