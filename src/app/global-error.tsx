"use client";

import "./globals.css";

import { SystemState } from "@/components/ui/system-state";
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
      <body className="min-h-dvh bg-background">
        <main className="flex min-h-dvh items-center justify-center px-4 py-16">
          <SystemState
            tone="error"
            title="Something went wrong"
            description={ERROR_CODES.INTERNAL.message}
            reference={error.digest}
            action={
              <button
                type="button"
                onClick={reset}
                className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
              >
                Try again
              </button>
            }
          />
        </main>
      </body>
    </html>
  );
}
