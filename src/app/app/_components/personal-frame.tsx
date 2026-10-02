import Link from "next/link";
import type { ReactNode } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { BrandLogo } from "@/components/shared/brand-logo";
import { SignOutButton } from "@/features/identity";

/**
 * Personal frame: the original authenticated header (Organisations, Security,
 * Account, Sign out) around a centred column. Used by the personal pages
 * (/app, account, security), by worker self-service pages and for members
 * whose only access is self-service — those are not moved into the
 * operational workspace shell (P0-E8-S1).
 */
export function PersonalFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border bg-surface">
        <PageContainer className="flex flex-wrap items-center justify-between gap-3 py-3">
          <Link href="/app" className="rounded-sm">
            <BrandLogo variant="mark" height={32} priority />
          </Link>
          <nav aria-label="Account" className="flex flex-wrap items-center gap-1 text-sm">
            <Link href="/app" className="rounded-md px-3 py-2 hover:bg-surface-muted">
              Organisations
            </Link>
            <Link href="/app/security" className="rounded-md px-3 py-2 hover:bg-surface-muted">
              Security
            </Link>
            <Link href="/app/account" className="rounded-md px-3 py-2 hover:bg-surface-muted">
              Account
            </Link>
            <SignOutButton />
          </nav>
        </PageContainer>
      </header>
      <main id={MAIN_CONTENT_ID} className="flex-1 py-8">
        <PageContainer className="flex flex-col gap-8">{children}</PageContainer>
      </main>
    </div>
  );
}
