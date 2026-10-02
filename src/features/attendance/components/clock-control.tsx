"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/errors";

import { clockInAction, clockOutAction, type ClockOutcome } from "../actions";

type ClockControlProps = {
  organisationId: string;
  assignmentId: string;
  kind: "in" | "out";
  locationRequired: boolean;
  facilityName: string;
};

type Position = { latitude: string; longitude: string; accuracy: string; capturedAt: string };

/** One-shot location for THIS action only; never watched, never polled. */
function currentPosition(): Promise<Position | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: String(position.coords.latitude),
          longitude: String(position.coords.longitude),
          accuracy: String(position.coords.accuracy),
          capturedAt: new Date(position.timestamp).toISOString(),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

/**
 * Large, mobile-first clock action. The server records its own time. If this
 * site checks location, the worker is told why BEFORE the browser prompt, and
 * the location is read once, only after they choose to continue.
 */
export function ClockControl({
  organisationId,
  assignmentId,
  kind,
  locationRequired,
  facilityName,
}: ClockControlProps) {
  const [state, setState] = useState<ActionResult<ClockOutcome> | null>(null);
  const [pending, startTransition] = useTransition();
  const [explaining, setExplaining] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const label = kind === "in" ? "Clock in" : "Clock out";

  function submit(position: Position | null) {
    const formData = new FormData();
    formData.set("organisationId", organisationId);
    formData.set("assignmentId", assignmentId);
    if (position) {
      formData.set("latitude", position.latitude);
      formData.set("longitude", position.longitude);
      formData.set("accuracy", position.accuracy);
      formData.set("capturedAt", position.capturedAt);
    }
    const action = kind === "in" ? clockInAction : clockOutAction;
    startTransition(async () => {
      try {
        setState(await action(null, formData));
      } catch {
        // Nothing is recorded unless Chelth confirms it: never fake success.
        setState(null);
        setNotice(
          "Not recorded: Chelth could not be reached. Check your connection and try again.",
        );
      }
    });
  }

  function start() {
    setNotice(null);
    setState(null);
    if (!locationRequired) return submit(null);
    setExplaining(true);
  }

  async function continueWithLocation() {
    setExplaining(false);
    setLocating(true);
    const position = await currentPosition();
    setLocating(false);
    if (!position) {
      setNotice("Your location could not be read. Chelth will record the attempt without it.");
    }
    submit(position);
  }

  const verb = kind === "in" ? "clock in" : "clock out";
  const failure = state && !state.ok ? state.error : null;
  const failureTitle = failure ? (FAILURE_TITLES[failure.code] ?? `Could not ${verb}`) : null;

  return (
    <div className="flex flex-col gap-3">
      {explaining ? (
        <div
          role="region"
          aria-label="Location check"
          className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 text-sm shadow-card"
        >
          <div className="flex items-start gap-3">
            <PinTile />
            <div className="flex flex-col gap-1">
              <p className="font-display text-base font-semibold text-chelth-navy">
                Verify your location
              </p>
              <p>
                {facilityName} checks that you are on site when you {verb}. Chelth uses your
                location only for this attendance action and does not track you.
              </p>
            </div>
          </div>
          <ul className="flex flex-col gap-1 text-muted-foreground">
            <li>Your location is read once, when you continue, and never in the background.</li>
            <li>Your agency sees the result; precise location is kept as restricted evidence.</li>
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={continueWithLocation} size="lg" className="w-full sm:w-auto">
              Share location and {label.toLowerCase()}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="w-full sm:w-auto"
              onClick={() => setExplaining(false)}
            >
              Not now
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="lg"
          variant={kind === "out" ? "outline" : "primary"}
          className="w-full"
          loading={pending || locating}
          onClick={start}
          aria-label={`${label} at ${facilityName}`}
        >
          {label}
        </Button>
      )}
      {locating ? (
        <p role="status" className="text-sm text-muted-foreground">
          Checking your location…
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {failure ? (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-lg border border-border bg-danger-soft p-3 text-sm text-danger-soft-foreground"
        >
          <p className="font-semibold">{failureTitle}</p>
          <p>{failure.message}</p>
        </div>
      ) : null}
      {state?.ok ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-border bg-success-soft p-3 text-sm text-success-soft-foreground"
        >
          <span aria-hidden="true" className="mt-0.5 font-bold">
            ✓
          </span>
          <span>
            <span className="block font-semibold">
              {kind === "in" ? "Clocked in" : "Clocked out"}.
            </span>
            {state.data.exceptionCodes.length > 0
              ? "Recorded. Your agency will review this attendance."
              : "Recorded at Chelth's server time."}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Plain-language headings for the existing attendance refusals (text, not colour). */
const FAILURE_TITLES: Record<string, string> = {
  OUTSIDE_GEOFENCE: "Outside the site area",
  LOCATION_ACCURACY_TOO_LOW: "Location not precise enough",
  LOCATION_UNAVAILABLE: "Location not available",
  GEOFENCE_REQUIRED: "Location needed for this site",
};

function PinTile() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-chelth-mint-mist text-chelth-teal-dark"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        className="size-5"
      >
        <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
    </span>
  );
}
