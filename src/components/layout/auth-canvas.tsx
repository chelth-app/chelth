import Link from "next/link";
import type { ReactNode } from "react";

import { BrandLogo } from "@/components/shared/brand-logo";

import { MAIN_CONTENT_ID } from "./skip-link";

/**
 * P9 auth / system-state canvas: calm Off White page with a flat Mint Mist
 * band (no gradients, glow or illustration — no approved artwork asset
 * exists), the canonical primary logo centred, and one centred column.
 */
export function AuthCanvas({ children }: { children: ReactNode }) {
  return (
    <main
      id={MAIN_CONTENT_ID}
      className="relative isolate flex min-h-dvh justify-center bg-background px-4 py-10 sm:items-center sm:py-16"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 -z-10 h-72 border-b border-border bg-chelth-mint-mist"
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
