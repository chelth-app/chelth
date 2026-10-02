import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { Panel } from "@/components/ui/panel";
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
      <PageHeader
        title="Security"
        description={
          <p className="text-sm">
            Administration in CHELTH requires verification with an authenticator app.
          </p>
        }
      />

      {notice === "mfa-enabled" ? (
        <p
          role="status"
          className="rounded-md bg-success-soft p-3 text-sm text-success-soft-foreground"
        >
          Your authenticator app is set up and this session is verified.
        </p>
      ) : null}

      <Panel titleId="mfa-heading" title={<>Authenticator app</>}>
        <p className="text-sm">
          This session:{" "}
          {assurance.current === "aal2" ? (
            <StatusChip tone="success">Verified with authenticator</StatusChip>
          ) : (
            <StatusChip tone="neutral">Password only</StatusChip>
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
      </Panel>
    </>
  );
}
