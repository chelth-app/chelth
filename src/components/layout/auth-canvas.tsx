import Link from "next/link";
import type { ReactNode } from "react";

import { BrandLogo } from "@/components/shared/brand-logo";

import { MAIN_CONTENT_ID } from "./skip-link";

/**
 * P9 auth / system-state canvas on the locked Chelth canvas (CHELTH-LOCKED-
 * VISUAL-SYSTEM.md, I): the off-white vertical wash (#FAFCFE → #F6FAFC →
 * #F1F9FA) with a very faint mint radial, the canonical primary logo centred,
 * and one centred column. No illustration, glow or marketing content.
 */
export function AuthCanvas({ children }: { children: ReactNode }) {
  return (
    <main
      id={MAIN_CONTENT_ID}
      className="relative isolate flex min-h-dvh justify-center bg-[linear-gradient(180deg,#fafcfe_0%,#f6fafc_55%,#f1f9fa_100%)] px-4 py-10 sm:items-center sm:py-16"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_45%_at_85%_100%,rgba(134,230,207,0.16),transparent_70%),radial-gradient(45%_35%_at_10%_0%,rgba(225,246,240,0.7),transparent_70%)]"
      />
      <div className="flex w-full max-w-md flex-col items-stretch gap-6">
        <Link href="/" className="mx-auto w-fit rounded-sm">
          <BrandLogo height={48} priority />
        </Link>
        {children}
      </div>
    </main>
  );
}
