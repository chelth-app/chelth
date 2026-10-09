"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const noSubscription = () => () => {};

/** iOS Safari, not yet installed: it has no install prompt, only the Share menu. */
function needsIosSteps(): boolean {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !standalone && /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/**
 * "Install Chelth" for the worker More sheet (P0-E9-3C). Android / Chromium:
 * shown only when the browser offers installation (beforeinstallprompt), and
 * only here — never a banner, never repeated. iOS: short Add to Home Screen
 * steps, because Safari cannot be prompted. Hidden once installed.
 */
export function InstallApp({ rowClassName }: { rowClassName: string }) {
  // Browser-only facts, read after hydration (the server renders nothing).
  const ios = useSyncExternalStore(noSubscription, needsIosSteps, () => false);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    function onPrompt(event: Event) {
      // Keep the browser's own menu option; offer it here instead of an infobar.
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    }
    function onInstalled() {
      setPrompt(null);
      setInstalled(true);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;
  if (prompt) {
    return (
      <button
        type="button"
        className={rowClassName}
        onClick={async () => {
          await prompt.prompt();
          await prompt.userChoice;
          // A prompt can be used once; the browser offers it again later if dismissed.
          setPrompt(null);
        }}
      >
        Install Chelth on this device
      </button>
    );
  }
  if (ios) {
    return (
      <div className="flex flex-col">
        <button
          type="button"
          aria-expanded={showSteps}
          className={rowClassName}
          onClick={() => setShowSteps((open) => !open)}
        >
          Add Chelth to your Home Screen
        </button>
        {showSteps ? (
          <p className="px-3 pb-2 text-sm text-muted-foreground">
            In Safari, tap Share, then Add to Home Screen. Chelth then opens like an app.
          </p>
        ) : null}
      </div>
    );
  }
  return null;
}
