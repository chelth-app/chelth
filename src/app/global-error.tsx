"use client";

import "./globals.css";

import { ERROR_CODES } from "@/lib/errors/error-codes";

/** Last-resort boundary when the root layout itself fails. Keep dependency-free. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-GB">
      <body className="min-h-dvh">
        <main className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-16" role="alert">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="text-muted-foreground">{ERROR_CODES.INTERNAL.message}</p>
          {error.digest ? (
            <p className="text-xs text-subtle-foreground">Reference: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="h-11 w-fit rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
