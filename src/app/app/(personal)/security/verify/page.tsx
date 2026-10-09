import type { Metadata } from "next";
import Link from "next/link";

import { AuthPanel, listMfaFactors, MfaChallengeForm } from "@/features/identity";
import { getSafeRedirectPath } from "@/lib/security/safe-redirect";

export const metadata: Metadata = { title: "Verify it's you" };

/** Step-up: raise this session to AAL2 before a privileged action. */
export default async function VerifyPage({ searchParams }: PageProps<"/app/security/verify">) {
  const [factors, { next }] = await Promise.all([listMfaFactors(), searchParams]);
  const safeNext = getSafeRedirectPath(typeof next === "string" ? next : undefined, "/app");

  return (
    <div className="mx-auto w-full max-w-md">
      <AuthPanel
        title="Verify it's you"
        icon="shield"
        description="Enter the code from your authenticator app to continue with administration tasks."
      >
        {factors.length > 0 ? (
          <MfaChallengeForm next={safeNext} />
        ) : (
          <p className="rounded-[10px] bg-[#f6fbfa] px-3 py-2.5 text-sm text-slate-700">
            You have not set up an authenticator app yet.{" "}
            <Link
              href={`/app/security?next=${encodeURIComponent(safeNext)}`}
              className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
            >
              Set one up
            </Link>
          </p>
        )}
      </AuthPanel>
    </div>
  );
}
