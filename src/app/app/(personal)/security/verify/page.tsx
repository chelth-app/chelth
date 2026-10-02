import type { Metadata } from "next";
import Link from "next/link";

import { StateIcon } from "@/components/ui/state-icon";
import { listMfaFactors, MfaChallengeForm } from "@/features/identity";
import { getSafeRedirectPath } from "@/lib/security/safe-redirect";

export const metadata: Metadata = { title: "Verify it's you" };

/** Step-up: raise this session to AAL2 before a privileged action. */
export default async function VerifyPage({ searchParams }: PageProps<"/app/security/verify">) {
  const [factors, { next }] = await Promise.all([listMfaFactors(), searchParams]);
  const safeNext = getSafeRedirectPath(typeof next === "string" ? next : undefined, "/app");

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-card sm:p-8">
      <header className="flex flex-col items-start gap-3">
        <StateIcon name="lock" />
        <h1 className="font-display text-2xl leading-8 font-semibold text-chelth-navy">
          Verify it&apos;s you
        </h1>
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
    </div>
  );
}
