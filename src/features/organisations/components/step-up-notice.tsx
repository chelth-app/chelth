import type { Route } from "next";
import Link from "next/link";

import { LockedNotice } from "@/components/reference/locked-notice";

/**
 * The existing authenticator step-up route, returning to `returnTo` once the
 * session is AAL2. Every "Verify …" prompt uses this one URL.
 */
export function stepUpHref(returnTo: string): string {
  return `/app/security/verify?next=${encodeURIComponent(returnTo)}`;
}

/**
 * Shown when privileged capabilities are held but the session is AAL1. The
 * locked warning note (P0-E8-QA-F3): same text, route and safe `next`.
 */
export function StepUpNotice({ returnTo, children }: { returnTo: string; children?: string }) {
  return (
    <div role="note">
      <LockedNotice
        tone="warning"
        title={children ?? "Administration requires verification with your authenticator app."}
      >
        <Link
          href={stepUpHref(returnTo) as Route}
          className="font-medium text-primary underline underline-offset-4"
        >
          Verify now
        </Link>
      </LockedNotice>
    </div>
  );
}
