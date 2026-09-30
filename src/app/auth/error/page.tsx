import type { Metadata } from "next";
import Link from "next/link";

import { PageContainer } from "@/components/layout/page-container";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { ErrorState } from "@/components/ui/error-state";
import { ERROR_CODES } from "@/lib/errors/error-codes";

export const metadata: Metadata = { title: "Link problem" };

export default function AuthErrorPage() {
  return (
    <main id={MAIN_CONTENT_ID}>
      <PageContainer className="py-16">
        <ErrorState
          title="We couldn't verify that link"
          message={ERROR_CODES.AUTH_LINK_INVALID.message}
          action={
            <Link href="/" className="text-sm text-primary underline underline-offset-4">
              Return home
            </Link>
          }
        />
      </PageContainer>
    </main>
  );
}
