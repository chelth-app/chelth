import Link from "next/link";
import type { ReactNode } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { BrandLogo } from "@/components/shared/brand-logo";
import { SignOutButton } from "@/features/identity";
import { requireAuthIdentityOrRedirect } from "@/lib/auth/session";

/**
 * Authenticated shell. The redirect here is UX only: every query is filtered
 * by RLS and every action re-checks identity and capability in the database.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireAuthIdentityOrRedirect("/app");

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
