import Link from "next/link";

/** Shown when privileged capabilities are held but the session is AAL1. */
export function StepUpNotice({ returnTo, children }: { returnTo: string; children?: string }) {
  return (
    <p role="note" className="rounded-md bg-warning-soft p-3 text-sm text-warning-soft-foreground">
      {children ?? "Administration requires verification with your authenticator app."}{" "}
      <Link
        href={`/app/security/verify?next=${encodeURIComponent(returnTo)}`}
        className="font-medium underline underline-offset-4"
      >
        Verify now
      </Link>
    </p>
  );
}
