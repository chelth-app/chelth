import Link from "next/link";
import type { ReactNode } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { BrandLogo } from "@/components/shared/brand-logo";
import { signOutAction } from "@/features/identity";

import { PlatformNav } from "./platform-nav";

/**
 * Platform control-plane frame (P0-E9-4A). Deliberately distinct from every
 * tenant workspace: no organisation name, no tenant sidebar, an explicit
 * "CHELTH PLATFORM — Platform administration" context and the signed-in
 * operator. Same locked canvas, logo and typography as the personal frame.
 */
export function PlatformFrame({
  operator,
  showNav,
  children,
}: {
  operator: string;
  showNav: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-[linear-gradient(180deg,#fafcfe_0%,#f6fafc_55%,#f1f9fa_100%)]">
      <header className="sticky top-0 z-30 border-b border-[rgba(18,107,103,0.10)] bg-white/95 backdrop-blur-[6px]">
        <PageContainer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
          <Link href="/platform" className="inline-flex min-h-11 items-center gap-3 rounded-sm">
            <BrandLogo variant="mark" height={32} priority />
            <span className="flex flex-col leading-tight">
              <span className="font-display text-[13px] font-bold tracking-[0.14em] text-chelth-navy">
                CHELTH PLATFORM
              </span>
              <span className="text-[12.5px] text-slate-600">Platform administration</span>
            </span>
          </Link>
          <nav aria-label="Account" className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] text-slate-700">
              <span className="sr-only">Signed in as </span>
              {operator}
            </span>
            <Link
              href="/app"
              className="inline-flex min-h-11 items-center rounded-[8px] px-3 text-[14px] font-medium text-primary underline-offset-4 hover:underline"
            >
              Your organizations
            </Link>
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
        {showNav ? (
          <PageContainer>
            <PlatformNav />
          </PageContainer>
        ) : null}
      </header>
      <main id={MAIN_CONTENT_ID} className="flex-1 py-8">
        <PageContainer className="flex flex-col gap-6">{children}</PageContainer>
      </main>
    </div>
  );
}
