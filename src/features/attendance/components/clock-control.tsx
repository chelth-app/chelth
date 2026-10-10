"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
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
type Reading = { position: Position } | { failure: "denied" | "unavailable" };

/**
 * One-shot location for THIS action only; never watched, never polled; a
 * fresh fix (maximumAge 0). The server decides whether it counts.
 */
function currentPosition(): Promise<Reading> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve({ failure: "unavailable" });
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          position: {
            latitude: String(position.coords.latitude),
            longitude: String(position.coords.longitude),
            accuracy: String(position.coords.accuracy),
            capturedAt: new Date(position.timestamp).toISOString(),
          },
        }),
      (error) =>
        resolve({ failure: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable" }),
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
  const label = kind === "in" ? "Check In" : "Check Out";

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
          kind === "in"
            ? "Check-in was not recorded. Try again."
            : "Check-out was not recorded. Try again.",
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
    const reading = await currentPosition();
    setLocating(false);
    if ("position" in reading) return submit(reading.position);
    // Check-in needs location evidence (P0-E9-3E): nothing is sent, nothing recorded.
    if (kind === "in") {
      setNotice(
        reading.failure === "denied"
          ? "Location access is required to check in."
          : "We couldn't determine your location. Try again.",
      );
      return;
    }
    // Check-out is never blocked by location: it is recorded without a reading.
    setNotice("Your location could not be read. Chelth will record your check-out without it.");
    submit(null);
  }

  const verb = kind === "in" ? "clock in" : "clock out";
  const failure = state && !state.ok ? state.error : null;
  const failureTitle = failure ? (FAILURE_TITLES[failure.code] ?? `Could not ${verb}`) : null;
  const failureNext = failure ? FAILURE_NEXT_STEPS[failure.code] : undefined;
  const flagged = state?.ok ? state.data.exceptionCodes.length > 0 : false;

  return (
    <div className="flex flex-col gap-3">
      {explaining ? (
        <div
          role="region"
          aria-label="Location check"
          className="flex flex-col items-center gap-4 rounded-[14px] border border-[rgba(18,107,103,0.12)] bg-white px-4 py-5 text-center text-sm shadow-[0_6px_18px_rgba(13,47,66,0.06)]"
        >
          <PinTile />
          <div className="flex flex-col gap-1.5">
            <p className="font-display text-[18px] leading-6 font-semibold text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]">
              Verify your location
            </p>
            <p className="text-slate-600">
              {facilityName} checks that you are on site when you {verb}. Chelth uses your location
              only for this attendance action and does not track you.
            </p>
          </div>
          <ul className="flex w-full flex-col gap-2 text-left text-[13px] leading-[18px] text-slate-600">
            <li className="flex items-start gap-2.5 rounded-[10px] bg-[#f6fbfa] px-3 py-2.5">
              <CheckDot />
              Your location is read once, when you continue, and never in the background.
            </li>
            <li className="flex items-start gap-2.5 rounded-[10px] bg-[#f6fbfa] px-3 py-2.5">
              <CheckDot />
              Your agency sees the result; precise location is kept as restricted evidence.
            </li>
          </ul>
          <div className="flex w-full flex-col gap-2">
            <Button onClick={continueWithLocation} size="lg" className="w-full">
              Share location and {label.toLowerCase()}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="w-full"
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
          className={cn(
            "w-full gap-2.5",
            kind === "out" &&
              "border-[rgba(229,72,77,0.55)] text-[#b42318] in-[.chelth-locked]:border-[rgba(229,72,77,0.55)] in-[.chelth-locked]:text-[#b42318] in-[.chelth-locked]:hover:border-[#b42318] in-[.chelth-locked]:hover:bg-danger-soft/40",
          )}
          loading={pending || locating}
          onClick={start}
          aria-label={`${label} at ${facilityName}`}
        >
          {pending || locating ? null : <ActionGlyph kind={kind} />}
          {label}
        </Button>
      )}
      {locating ? (
        <p
          role="status"
          className="flex items-center gap-2.5 rounded-[10px] bg-[#f6fbfa] px-3 py-2.5 text-[13px] text-slate-600"
        >
          <PinGlyph />
          Checking your location…
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-[10px] border border-[rgba(180,120,20,0.12)] bg-warning-soft/40 px-3 py-2.5 text-[13px] text-slate-700"
        >
          {notice}
        </p>
      ) : null}
      {failure ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-[12px] border border-[rgba(229,72,77,0.18)] bg-danger-soft/50 px-3.5 py-3 text-[13px] leading-[18px]"
        >
          <StateDot tone="danger" />
          <div className="flex flex-col gap-0.5">
            <p className="text-[14px] leading-5 font-semibold text-[#9a1e14]">{failureTitle}</p>
            <p className="text-slate-700">{failure.message}</p>
            {failureNext ? <p className="text-slate-600">{failureNext}</p> : null}
          </div>
        </div>
      ) : null}
      {state?.ok ? (
        <div
          role="status"
          className={cn(
            "flex items-start gap-3 rounded-[12px] border px-3.5 py-3 text-[13px] leading-[18px]",
            flagged
              ? "border-[rgba(180,120,20,0.14)] bg-warning-soft/40"
              : "border-[rgba(18,107,103,0.12)] bg-[linear-gradient(180deg,#f6fbfa,#eef7f4)]",
          )}
        >
          <StateDot tone={flagged ? "warning" : "success"} />
          <span className="flex flex-col gap-0.5">
            <span className="text-[14px] leading-5 font-semibold text-chelth-navy">
              {kind === "in" ? "Clocked in" : "Clocked out"}.
            </span>
            <span className="text-slate-600">
              {flagged
                ? "Recorded. Your agency will review this attendance."
                : locationRequired
                  ? "Recorded at Chelth's server time. You're within the approved site area."
                  : "Recorded at Chelth's server time."}
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Plain-language headings for the existing attendance refusals (text, not colour). */
const FAILURE_TITLES: Record<string, string> = {
  OUTSIDE_GEOFENCE: "Outside the check-in area",
  LOCATION_ACCURACY_TOO_LOW: "Location not precise enough",
  LOCATION_UNAVAILABLE: "Location not available",
  GEOFENCE_REQUIRED: "Location access needed",
  GEOFENCE_NOT_CONFIGURED: "Check-in not available yet",
};

/** What the worker can do next after a refusal (guidance only; the rule is the server's). */
const FAILURE_NEXT_STEPS: Record<string, string> = {
  OUTSIDE_GEOFENCE: "Move closer to the facility and try again, or contact your agency.",
  LOCATION_ACCURACY_TOO_LOW:
    "Wait for a stronger signal (near a window or outside the building) and try again.",
  LOCATION_UNAVAILABLE: "Allow location access for this site in your browser, then try again.",
  GEOFENCE_REQUIRED: "Allow location access for this site in your browser, then try again.",
};

function PinGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="size-[18px] shrink-0 text-chelth-teal-dark"
    >
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

/** Clock in: location pin; clock out: exit arrow (same line family). */
function ActionGlyph({ kind }: { kind: "in" | "out" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="size-5 shrink-0"
    >
      {kind === "in" ? (
        <>
          <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
          <circle cx="12" cy="10" r="2.5" />
        </>
      ) : (
        <>
          <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
          <path d="M9 16l-4-4 4-4M5 12h10" />
        </>
      )}
    </svg>
  );
}

function CheckDot() {
  return (
    <span
      aria-hidden="true"
      className="mt-px inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-success-indicator text-white"
    >
      <svg
        viewBox="0 0 16 16"
        className="size-2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
      >
        <path d="m4 8.5 2.5 2.5L12 5.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** Semantic glyph beside a state message (the message text carries the meaning). */
function StateDot({ tone }: { tone: "success" | "warning" | "danger" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-0.5 inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-white",
        tone === "success"
          ? "bg-success-indicator"
          : tone === "warning"
            ? "bg-warning-indicator"
            : "bg-danger-indicator",
      )}
    >
      <svg
        viewBox="0 0 16 16"
        className="size-3"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
      >
        {tone === "success" ? (
          <path d="m4 8.5 2.5 2.5L12 5.5" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M8 4.5v4.5M8 11.5v.01" strokeLinecap="round" />
        )}
      </svg>
    </span>
  );
}

/** Luminous pin tile (locked drawer identity tile, smaller). */
function PinTile() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-14 shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_30%_25%,#f4fdfa_0%,#d3f2e8_45%,#a9e3d3_100%)] text-chelth-teal-dark shadow-[0_6px_16px_rgba(0,90,96,0.16),inset_0_1px_0_rgba(255,255,255,0.9)]"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        className="size-6"
      >
        <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
    </span>
  );
}
