import { describe, expect, it } from "vitest";

import { geofencePolicySchema, geofenceSchema } from "@/features/attendance/schemas";
import {
  checkInBlockedByConfiguration,
  deriveAttendanceState,
  formatLocalClockTime,
  GEOFENCE_POLICY_DEFAULTS,
  geofenceFormValues,
  REJECTION_RESOLUTIONS,
  summariseGeofenceReadiness,
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

describe("geofence settings and pilot readiness (P0-E9-3E.1)", () => {
  const policy = {
    requireGeofence: true,
    defaultRadiusMeters: 150,
    defaultMaxAccuracyMeters: 100,
    defaultOutsidePolicy: "block" as const,
  };

  it("new agencies: geofencing optional, 150 m radius, 100 m accuracy, block outside", () => {
    expect(GEOFENCE_POLICY_DEFAULTS).toEqual({
      requireGeofence: false,
      defaultRadiusMeters: 150,
      defaultMaxAccuracyMeters: 100,
      defaultOutsidePolicy: "block",
    });
  });

  it("a new location is prefilled from the agency defaults, never with a site centre", () => {
    expect(geofenceFormValues(null, { ...policy, defaultRadiusMeters: 300 })).toEqual({
      enabled: true,
      latitude: null,
      longitude: null,
      radiusMeters: 300,
      maxAccuracyMeters: 100,
      outsidePolicy: "block",
      fromDefaults: true,
    });
  });

  it("a saved location geofence is never overwritten by the defaults", () => {
    const saved = {
      enabled: true,
      latitude: 41.8781,
      longitude: -87.6298,
      radiusMeters: 75,
      maxAccuracyMeters: 50,
      outsidePolicy: "allow_with_review" as const,
    };
    expect(geofenceFormValues(saved, policy)).toEqual({ ...saved, fromDefaults: false });
  });

  it("check-in is blocked by configuration only when geofencing is required (mirrors the database)", () => {
    for (const readiness of ["not_configured", "disabled", "invalid"] as const) {
      expect(checkInBlockedByConfiguration(true, readiness)).toBe(true);
      expect(checkInBlockedByConfiguration(false, readiness)).toBe(false);
    }
    expect(checkInBlockedByConfiguration(true, "ready")).toBe(false);
    expect(checkInBlockedByConfiguration(true, "not_blocking")).toBe(false);
  });

  it("pilot readiness: READY only when required and every active location blocks outside", () => {
    const rows = [
      { locationActive: true, readiness: "ready" as const },
      { locationActive: true, readiness: "ready" as const },
      { locationActive: false, readiness: "not_configured" as const },
    ];
    expect(summariseGeofenceReadiness(rows, true)).toMatchObject({
      activeLocations: 2,
      blockingLocations: 2,
      blockedLocations: 0,
      status: "ready",
    });
    expect(summariseGeofenceReadiness(rows, false)).toMatchObject({
      status: "not_ready",
      reason: "not_required",
    });
    expect(
      summariseGeofenceReadiness(
        [...rows, { locationActive: true, readiness: "not_configured" as const }],
        true,
      ),
    ).toMatchObject({
      activeLocations: 3,
      blockingLocations: 2,
      blockedLocations: 1,
      status: "not_ready",
      reason: "locations_need_setup",
    });
    expect(
      summariseGeofenceReadiness([{ locationActive: true, readiness: "not_blocking" }], true),
    ).toMatchObject({ blockedLocations: 0, status: "not_ready" });
    expect(summariseGeofenceReadiness([], true)).toMatchObject({ reason: "no_locations" });
  });

  it("a configuration refusal tells the worker to contact their agency, without technical detail", () => {
    const error = normalizeError({ code: "CHT23", message: "internal detail" });
    expect(error.code).toBe("GEOFENCE_NOT_CONFIGURED");
    expect(ERROR_CODES.GEOFENCE_NOT_CONFIGURED.message).toBe(
      "Check-in isn't available because this location hasn't been configured yet. Contact your agency.",
    );
    expect(ERROR_CODES.GEOFENCE_NOT_CONFIGURED.message).not.toMatch(/geofence|radius|CHT/i);
  });
});

describe("geofence form validation", () => {
  const base = {
    organisationId: "00000000-0000-4000-8000-000000000001",
    defaultMaxAccuracyMeters: "100",
    defaultOutsidePolicy: "block",
  };
  const radius = (value: string) =>
    geofencePolicySchema.safeParse({ ...base, defaultRadiusMeters: value }).success;

  it("radius is whole metres between 50 and 2000", () => {
    expect(radius("50")).toBe(true);
    expect(radius("2000")).toBe(true);
    expect(radius("49")).toBe(false);
    expect(radius("2001")).toBe(false);
    expect(radius("0")).toBe(false);
    expect(radius("-150")).toBe(false);
    expect(radius("abc")).toBe(false);
    expect(radius("NaN")).toBe(false);
    expect(radius("150.5")).toBe(false);
  });

  it("accuracy is between 10 and 500 metres", () => {
    const accuracy = (value: string) =>
      geofencePolicySchema.safeParse({
        ...base,
        defaultRadiusMeters: "150",
        defaultMaxAccuracyMeters: value,
      }).success;
    expect(accuracy("10")).toBe(true);
    expect(accuracy("500")).toBe(true);
    expect(accuracy("9")).toBe(false);
    expect(accuracy("501")).toBe(false);
  });

  it("an empty site centre is missing, never 0°", () => {
    const location = {
      organisationId: base.organisationId,
      facilityId: base.organisationId,
      locationId: base.organisationId,
      radiusMeters: "150",
      maxAccuracyMeters: "100",
      outsidePolicy: "block",
    };
    expect(geofenceSchema.safeParse({ ...location, latitude: "", longitude: "" }).success).toBe(
      false,
    );
    expect(
      geofenceSchema.safeParse({ ...location, latitude: "NaN", longitude: "-87.6" }).success,
    ).toBe(false);
    expect(
      geofenceSchema.safeParse({ ...location, latitude: "41.8781", longitude: "-87.6298" }).data,
    ).toMatchObject({ latitude: 41.8781, longitude: -87.6298, radiusMeters: 150 });
  });
});
