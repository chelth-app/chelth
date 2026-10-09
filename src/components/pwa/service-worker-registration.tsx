"use client";

import { useEffect } from "react";

import { isDevelopmentBuild } from "@/config/runtime";

/**
 * Registers the static-only service worker (public/sw.js) in production
 * builds over a secure context. `updateViaCache: "none"` makes the browser
 * re-check sw.js on every navigation, so a new deployment's worker is picked
 * up promptly; pages themselves are never served from its cache.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (isDevelopmentBuild) return;
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Installability is optional: the app works the same without it.
    });
  }, []);
  return null;
}
