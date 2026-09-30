import { describe, expect, it } from "vitest";

import {
  deriveAttendanceState,
  formatLocalClockTime,
  REJECTION_RESOLUTIONS,
  zonedLocalToInstant,
} from "@/lib/domain/attendance";
import { ERROR_CODES, normalizeError } from "@/lib/errors";
import { renderNotification } from "@/lib/notifications";

describe("attendance state", () => {
  it("open exceptions make a record need review regardless of clock state", () => {
    expect(deriveAttendanceState("clocked_in", false)).toBe("clocked_in");
    expect(deriveAttendanceState("clocked_out", true)).toBe("needs_review");
    expect(deriveAttendanceState("not_started", true)).toBe("needs_review");
  });

  it("a rejection can never use the approval resolution", () => {
    expect(REJECTION_RESOLUTIONS).not.toContain("approved_as_requested");
  });
});

describe("local correction times → instants (facility timezone, DST-safe)", () => {
  it("converts a New York winter time", () => {
    expect(zonedLocalToInstant("2030-01-15", "07:03", "America/New_York")).toBe(
      "2030-01-15T12:03:00.000Z",
    );
  });

  it("converts a New York summer time", () => {
    expect(zonedLocalToInstant("2030-07-15", "07:03", "America/New_York")).toBe(
      "2030-07-15T11:03:00.000Z",
    );
  });

  it("the same wall time is a different instant in another facility timezone", () => {
    expect(zonedLocalToInstant("2030-01-15", "07:03", "America/Chicago")).toBe(
      "2030-01-15T13:03:00.000Z",
    );
  });

  it("rejects a time inside the spring-forward gap", () => {
    expect(zonedLocalToInstant("2030-03-10", "02:30", "America/New_York")).toBeNull();
  });

  it("resolves the repeated fall-back hour to the later (standard-time) instant, like the database", () => {
    expect(zonedLocalToInstant("2030-11-03", "01:30", "America/New_York")).toBe(
      "2030-11-03T06:30:00.000Z",
    );
  });

  it("rejects malformed input", () => {
    expect(zonedLocalToInstant("2030-13-99", "25:00", "America/New_York")).toBeNull();
  });

  it("displays clock times in the shift's own timezone", () => {
    expect(formatLocalClockTime("2030-01-15T12:03:00Z", "America/New_York")).toBe("7:03 AM EST");
    expect(formatLocalClockTime(null, "America/New_York")).toBe("—");
  });
});

describe("attendance errors", () => {
  it.each([
    ["CHT04", "ATTENDANCE_NOT_FOUND"],
    ["CHT05", "ASSIGNMENT_NOT_ACCEPTED"],
    ["CHT06", "SHIFT_CANCELLED"],
    ["CHT07", "TOO_EARLY_TO_CLOCK_IN"],
    ["CHT09", "ALREADY_CLOCKED_IN"],
    ["CHT10", "NOT_CLOCKED_IN"],
    ["CHT11", "ALREADY_CLOCKED_OUT"],
    ["CHT12", "GEOFENCE_REQUIRED"],
    ["CHT14", "LOCATION_ACCURACY_TOO_LOW"],
    ["CHT16", "CORRECTION_NOT_ALLOWED"],
    ["CHT17", "CORRECTION_ALREADY_REVIEWED"],
    ["CHT18", "CLOCK_OUT_WINDOW_CLOSED"],
  ])("maps %s to %s", (sqlstate, code) => {
    expect(normalizeError({ code: sqlstate, message: "raw" }).code).toBe(code);
  });

  it("the outside-geofence message does not claim certainty about the worker's location", () => {
    expect(ERROR_CODES.OUTSIDE_GEOFENCE.message).toMatch(/appear/);
  });
});

describe("attendance emails", () => {
  const base = {
    path: "/app/organisations/11111111-1111-4111-8111-111111111111/my-shifts",
    agencyName: "Alpha Care",
    facilityName: "Mercy Rehab",
    workerName: "Walt",
    startAt: "2030-07-15T11:00:00Z",
    endAt: "2030-07-15T19:00:00Z",
    timezone: "America/New_York",
  };

  it("tells a worker how to fix a missed clock-out, without location data", () => {
    const rendered = renderNotification(
      { ...base, event: "attendance_missed_clock_out", audience: "worker" },
      "https://app.example",
    );
    expect(rendered.text).toContain("request a correction");
    expect(rendered.text).not.toMatch(/latitude|longitude|metres|meters/i);
  });

  it("tells agency reviewers about a refused clock-in without the reason detail", () => {
    const rendered = renderNotification(
      { ...base, event: "attendance_clock_in_blocked", audience: "agency" },
      "https://app.example",
    );
    expect(rendered.subject).toBe("Clock-in refused: Walt, Mercy Rehab, Mon, Jul 15, 2030");
    expect(rendered.text).not.toMatch(/outside|geofence|credential/i);
  });
});
