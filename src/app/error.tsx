"use client";

import { PageContainer } from "@/components/layout/page-container";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { ERROR_CODES } from "@/lib/errors/error-codes";

/**
 * Route-level error boundary. Shows only a safe generic message plus the
 * error digest as a support reference; the real error is logged server-side
 * by src/instrumentation.ts.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id={MAIN_CONTENT_ID}>
      <PageContainer className="py-16">
        <ErrorState
          message={ERROR_CODES.INTERNAL.message}
          reference={error.digest}
          action={
            <Button variant="outline" onClick={reset}>
              Try again
            </Button>
          }
        />
      </PageContainer>
    </main>
  );
}
