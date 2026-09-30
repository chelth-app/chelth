import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { listMfaFactors, MfaEnrollment } from "@/features/identity";
import { getAssurance } from "@/lib/auth/session";
import { getSafeRedirectPath } from "@/lib/security/safe-redirect";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage({ searchParams }: PageProps<"/app/security">) {
  const [factors, assurance, { next, notice }] = await Promise.all([
    listMfaFactors(),
    getAssurance(),
    searchParams,
  ]);
  const safeNext = typeof next === "string" ? getSafeRedirectPath(next, "/app") : undefined;

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Security</h1>
        <p className="text-sm text-muted-foreground">
          Administration in CHELTH requires verification with an authenticator app.
        </p>
      </header>

      {notice === "mfa-enabled" ? (
        <p
          role="status"
          className="rounded-md bg-success-soft p-3 text-sm text-success-soft-foreground"
        >
          Your authenticator app is set up and this session is verified.
        </p>
      ) : null}

      <section aria-labelledby="mfa-heading" className="flex flex-col gap-3">
        <h2 id="mfa-heading" className="text-lg font-semibold">
          Authenticator app
        </h2>
        <p className="text-sm">
          This session:{" "}
          {assurance.current === "aal2" ? (
            <Badge tone="success">Verified with authenticator</Badge>
          ) : (
            <Badge tone="neutral">Password only</Badge>
          )}
        </p>
        {factors.length > 0 ? (
          <>
            <p className="text-sm text-muted-foreground">
              An authenticator app is set up for your account.
            </p>
            {assurance.current !== "aal2" ? (
              <Link
                href={`/app/security/verify?next=${encodeURIComponent(safeNext ?? "/app/security")}`}
                className="w-fit text-sm text-primary underline underline-offset-4"
              >
                Verify this session
              </Link>
            ) : null}
          </>
        ) : (
          <MfaEnrollment next={safeNext} />
        )}
      </section>
    </>
  );
}
