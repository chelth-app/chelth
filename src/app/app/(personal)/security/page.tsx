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
    // Purposeful width (P0-E8-A1.3): left-aligned 760 px column, locked panel.
    <div className="chelth-locked flex w-full max-w-[760px] flex-col gap-6">
      <PageHeader
        variant="reference"
        title="Security"
        description={
          <p>Administration in CHELTH requires verification with an authenticator app.</p>
        }
      />

      {notice === "mfa-enabled" ? (
        <p
          role="status"
          className="rounded-[12px] border border-[rgba(18,107,103,0.12)] bg-[linear-gradient(180deg,#f6fbfa,#eef7f4)] px-4 py-3 text-sm font-medium text-chelth-navy"
        >
          Your authenticator app is set up and this session is verified.
        </p>
      ) : null}

      <Panel titleId="mfa-heading" title={<>Authenticator app</>}>
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
          This session:{" "}
          {assurance.current === "aal2" ? (
            <StatusChip tone="success">Verified with authenticator</StatusChip>
          ) : (
            <StatusChip tone="neutral">Password only</StatusChip>
          )}
        </p>
        {factors.length > 0 ? (
          <>
            <p className="text-sm text-slate-600">
              An authenticator app is set up for your account.
            </p>
            {assurance.current !== "aal2" ? (
              <Link
                href={`/app/security/verify?next=${encodeURIComponent(safeNext ?? "/app/security")}`}
                className="inline-flex min-h-11 w-fit items-center rounded-[8px] border border-[rgba(0,90,96,0.35)] bg-white px-4 text-sm font-semibold text-chelth-navy shadow-[0_1px_2px_rgba(13,47,66,0.05)] hover:border-chelth-teal-dark hover:bg-[#f4fbf9]"
              >
                Verify this session
              </Link>
            ) : null}
          </>
        ) : (
          <MfaEnrollment next={safeNext} />
        )}
      </Panel>
    </div>
  );
}
