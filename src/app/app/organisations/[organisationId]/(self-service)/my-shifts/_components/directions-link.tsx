"use client";

import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils/cn";

const noSubscription = () => () => {};
const isApple = () => /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);

/**
 * "Get directions" (P0-E9-3D-S2): a destination-only deep link. Apple devices
 * open Apple Maps; everything else opens Google Maps (the app on Android when
 * installed, the browser otherwise). Only the facility address is sent — never
 * the worker, the shift or the current location.
 */
export function DirectionsLink({
  destination,
  className,
  children,
}: {
  destination: string;
  className?: string;
  children: React.ReactNode;
}) {
  const apple = useSyncExternalStore(noSubscription, isApple, () => false);
  const query = encodeURIComponent(destination);
  const href = apple
    ? `https://maps.apple.com/?daddr=${query}`
    : `https://www.google.com/maps/dir/?api=1&destination=${query}`;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn(className)}>
      {children}
      <span className="sr-only"> (opens your maps app)</span>
    </a>
  );
}
