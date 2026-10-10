"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * A server timestamp shown in the viewer's own time zone ("8:42 AM" today,
 * "Apr 22" otherwise, or a full date-time). Rendered after hydration so the
 * server never guesses the device's time zone.
 */
export function LocalTime({ iso, mode = "short" }: { iso: string; mode?: "short" | "full" }) {
  const label = useSyncExternalStore(
    noSubscription,
    () => format(iso, mode),
    () => "",
  );
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {label}
    </time>
  );
}

function format(iso: string, mode: "short" | "full"): string {
  const date = new Date(iso);
  if (mode === "full") {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
      date,
    );
  }
  const today = new Date().toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(
    undefined,
    today ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" },
  ).format(date);
}
