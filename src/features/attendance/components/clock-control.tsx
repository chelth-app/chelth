"use client";

import { useState, useTransition } from "react";

import { FormAlert } from "@/components/forms/form-alert";
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
    if (!locationRequired) return submit(null);
    setExplaining(true);
  }

  async function continueWithLocation() {
    setExplaining(false);
    const position = await currentPosition();
    if (!position) {
      setNotice("Your location could not be read. Chelth will record the attempt without it.");
    }
    submit(position);
  }

  return (
    <div className="flex flex-col gap-2">
      {explaining ? (
        <div
          role="region"
          aria-label="Location check"
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-sm"
        >
          <p>
            {facilityName} checks that you are on site when you{" "}
            {kind === "in" ? "clock in" : "clock out"}. Chelth uses your location only for this
            attendance action and does not track you.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={continueWithLocation} size="lg">
              Share location and {label.toLowerCase()}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => setExplaining(false)}>
              Not now
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="lg"
          className="w-full sm:w-auto"
          loading={pending}
          onClick={start}
          aria-label={`${label} at ${facilityName}`}
        >
          {label}
        </Button>
      )}
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      <FormAlert
        state={state}
        successMessage={
          state?.ok
            ? `${kind === "in" ? "Clocked in" : "Clocked out"}.${state.data.exceptionCodes.length > 0 ? " Your agency will review this attendance." : ""}`
            : undefined
        }
      />
    </div>
  );
}
