"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const INTERVAL_MS = 5_000;
const MAX_CHECKS = 36; // About three minutes; after that the worker can reload.

/**
 * While a document is being checked, re-reads the page (server state only) so
 * "Checking document…" turns into the scanner's real outcome without a manual
 * reload. Stops when hidden, after a bounded number of checks, or when no
 * document is being checked any more.
 *
 * A worker cannot read a document the scanner rejected or quarantined (RLS), so
 * such a document simply leaves the page. When one that was being checked
 * disappears while the page is open, the worker is told plainly.
 */
export function RefreshWhileChecking({
  checkingIds,
  visibleIds,
}: {
  checkingIds: string[];
  visibleIds: string[];
}) {
  const router = useRouter();
  const active = checkingIds.length > 0;
  // Derived from the previous server render (React's "previous props" pattern).
  const key = `${checkingIds.join(",")}|${visibleIds.join(",")}`;
  const [tracked, setTracked] = useState({ key, watched: checkingIds, unusable: false });
  if (tracked.key !== key) {
    const visible = new Set(visibleIds);
    const gone = tracked.watched.some((id) => !visible.has(id));
    const started = checkingIds.some((id) => !tracked.watched.includes(id));
    setTracked({
      key,
      watched: checkingIds,
      unusable: gone ? true : started ? false : tracked.unusable,
    });
  }

  useEffect(() => {
    if (!active) return;
    let checks = 0;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || navigator.onLine === false) return;
      checks += 1;
      if (checks > MAX_CHECKS) {
        window.clearInterval(timer);
        return;
      }
      router.refresh();
    }, INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, router]);

  return tracked.unusable ? (
    <p
      role="alert"
      className="rounded-[10px] border border-[rgba(180,35,24,0.18)] bg-danger-soft px-3 py-2 text-[13px] leading-[18px] font-medium text-danger-soft-foreground"
    >
      This document cannot be used. Upload a different file.
    </p>
  ) : null;
}
