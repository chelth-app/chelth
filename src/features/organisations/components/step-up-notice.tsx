import type { Route } from "next";
import Link from "next/link";

/**
 * The existing authenticator step-up route, returning to `returnTo` once the
 * session is AAL2. Every "Verify …" prompt uses this one URL.
 */
export function stepUpHref(returnTo: string): string {
  return `/app/security/verify?next=${encodeURIComponent(returnTo)}`;
}

/** Shown when privileged capabilities are held but the session is AAL1. */
export function StepUpNotice({ returnTo, children }: { returnTo: string; children?: string }) {
  return (
    <p role="note" className="rounded-md bg-warning-soft p-3 text-sm text-warning-soft-foreground">
      {children ?? "Administration requires verification with your authenticator app."}{" "}
      <Link
        href={stepUpHref(returnTo) as Route}
        className="font-medium underline underline-offset-4"
      >
        Verify now
      </Link>
    </p>
  );
}
