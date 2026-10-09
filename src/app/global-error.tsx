"use client";

import "./globals.css";

import { stateActionClass, SystemState } from "@/components/ui/system-state";
import { ERROR_CODES } from "@/lib/errors/error-codes";

/** Last-resort boundary when the root layout itself fails. Keep dependency-light. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-GB">
      <body className="min-h-dvh bg-[linear-gradient(180deg,#fafcfe_0%,#f6fafc_55%,#f1f9fa_100%)]">
        <main className="flex min-h-dvh items-center justify-center px-4 py-16">
          <SystemState
            tone="error"
            title="We couldn't load this page"
            description={ERROR_CODES.INTERNAL.message}
            reference={error.digest}
            action={
              <button type="button" onClick={reset} className={stateActionClass}>
                Try again
              </button>
            }
          />
        </main>
      </body>
    </html>
  );
}
