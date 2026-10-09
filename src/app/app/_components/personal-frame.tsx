import Link from "next/link";
import type { ReactNode } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { BrandLogo } from "@/components/shared/brand-logo";
import { signOutAction } from "@/features/identity";

import { PersonalNav } from "./personal-nav";

/**
 * Personal frame (locked system, P0-E8-A1.1): a light signed-in frame — never
 * the operational sidebar or the worker bottom navigation. Sticky white header
 * with a teal hairline, the canonical Chelth logo, and compact account
 * navigation (Organisations, Security, Account — current marked) plus Sign
 * out (same action as before), on the locked off-white canvas. Used by the
 * personal pages (/app, account, security), by worker self-service pages and
 * for members whose only access is self-service.
 */
export function PersonalFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[linear-gradient(180deg,#fafcfe_0%,#f6fafc_55%,#f1f9fa_100%)]">
      <header className="sticky top-0 z-30 border-b border-[rgba(18,107,103,0.10)] bg-white/95 backdrop-blur-[6px]">
        <PageContainer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
          <Link href="/app" className="inline-flex min-h-11 items-center rounded-sm">
            <span className="sm:hidden">
              <BrandLogo variant="mark" height={32} priority />
            </span>
            <span className="hidden sm:inline">
              <BrandLogo height={34} priority />
            </span>
          </Link>
          <nav aria-label="Account" className="flex flex-wrap items-center gap-1">
            <PersonalNav />
            <form action={signOutAction}>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-[8px] border border-[rgba(0,90,96,0.25)] bg-white px-3 text-[14px] font-semibold text-chelth-navy hover:border-chelth-teal-dark hover:bg-[#f4fbf9]"
              >
                Sign out
              </button>
            </form>
          </nav>
        </PageContainer>
      </header>
      <main id={MAIN_CONTENT_ID} className="flex-1 py-8">
        <PageContainer className="flex flex-col gap-7">{children}</PageContainer>
      </main>
    </div>
  );
}
