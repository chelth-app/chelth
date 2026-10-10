"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { markThreadReadAction } from "../actions";

const REFRESH_MS = 15_000;

/**
 * Marks the open thread read (only when it really has unread messages) and
 * re-reads it while visible so replies appear. Server state only: no message
 * content is kept in the browser.
 */
export function ThreadLive({ threadId, unread }: { threadId: string; unread: number }) {
  const router = useRouter();
  useEffect(() => {
    if (unread === 0) return;
    // Then re-read so unread badges (More, Messages) clear.
    void markThreadReadAction(threadId).then((result) => {
      if (result.ok) router.refresh();
    });
  }, [threadId, unread, router]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine !== false) router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router]);
  return null;
}
