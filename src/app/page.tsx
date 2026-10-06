import Link from "next/link";

import { PageContainer } from "@/components/layout/page-container";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { BrandLogo } from "@/components/shared/brand-logo";

/**
 * Foundation landing page. Intentionally minimal: product surfaces (agency,
 * facility and worker experiences) are built in later stages.
 */
export default function HomePage() {
  return (
    <main id={MAIN_CONTENT_ID} className="flex min-h-dvh items-center">
      <PageContainer className="flex flex-col gap-6 py-16">
        <BrandLogo priority />
        <h1 className="max-w-2xl font-display text-3xl font-semibold tracking-[-0.03em] text-chelth-navy sm:text-4xl">
          Reliable workforce operations for healthcare staffing.
        </h1>
        <p className="max-w-xl text-base text-muted-foreground">
          The Chelth platform is being established. Operational modules will be introduced in
          upcoming releases.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/sign-in"
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex min-h-11 items-center rounded-md border border-input-border bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-muted"
          >
            Create account
          </Link>
        </div>
      </PageContainer>
    </main>
  );
}
