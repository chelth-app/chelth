import type { Metadata } from "next";
import Link from "next/link";

import { listMfaFactors, MfaChallengeForm } from "@/features/identity";
import { getSafeRedirectPath } from "@/lib/security/safe-redirect";

export const metadata: Metadata = { title: "Verify it's you" };

/** Step-up: raise this session to AAL2 before a privileged action. */
export default async function VerifyPage({ searchParams }: PageProps<"/app/security/verify">) {
  const [factors, { next }] = await Promise.all([listMfaFactors(), searchParams]);
  const safeNext = getSafeRedirectPath(typeof next === "string" ? next : undefined, "/app");

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Verify it&apos;s you</h1>
        <p className="text-sm text-muted-foreground">
          Enter the code from your authenticator app to continue with administration tasks.
        </p>
      </header>
      {factors.length > 0 ? (
        <MfaChallengeForm next={safeNext} />
      ) : (
        <p className="text-sm">
          You have not set up an authenticator app yet.{" "}
          <Link
            href={`/app/security?next=${encodeURIComponent(safeNext)}`}
            className="text-primary underline underline-offset-4"
          >
            Set one up
          </Link>
        </p>
      )}
    </>
  );
}
