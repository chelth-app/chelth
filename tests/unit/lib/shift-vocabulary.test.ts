import { describe, expect, it } from "vitest";

import {
  ASSIGNMENT_BLOCK_ERROR,
  ASSIGNMENT_BLOCK_REASON_LABELS,
  ASSIGNMENT_BLOCK_REASONS,
  ASSIGNMENT_CANCELLATION_REASONS,
  daysUntilDate,
  deriveFillState,
  disciplineNameParts,
  formatShiftDate,
  formatShiftTimeRange,
  formatShiftTimeRangeParts,
  isActiveAssignment,
  localDate,
  SHIFT_STATUS_TRANSITIONS,
  SHIFT_STATUSES,
  shiftDurationHours,
  startsLocalToday,
  startsWithin,
} from "@/lib/domain/shifts";
import { ERROR_CODES, normalizeError } from "@/lib/errors";

describe("shift lifecycle vocabulary", () => {
  it("covers every stored shift status; terminal states have no transitions", () => {
    expect(Object.keys(SHIFT_STATUS_TRANSITIONS).sort()).toEqual([...SHIFT_STATUSES].sort());
    expect(SHIFT_STATUS_TRANSITIONS.cancelled).toEqual([]);
    expect(SHIFT_STATUS_TRANSITIONS.completed).toEqual([]);
  });

  it("fill state is derived, never stored", () => {
    expect(SHIFT_STATUSES).not.toContain("filled");
    expect(SHIFT_STATUSES).not.toContain("partially_filled");
    expect(deriveFillState(0, 4)).toBe("unfilled");
    expect(deriveFillState(3, 4)).toBe("partially_filled");
    expect(deriveFillState(4, 4)).toBe("filled");
  });

  it("only assigned and accepted assignments are active", () => {
    expect(isActiveAssignment("assigned")).toBe(true);
    expect(isActiveAssignment("accepted")).toBe(true);
    expect(isActiveAssignment("declined")).toBe(false);
    expect(isActiveAssignment("cancelled")).toBe(false);
  });

  it("agencies cannot pick the reserved shift_cancelled reason", () => {
    expect(ASSIGNMENT_CANCELLATION_REASONS).not.toContain("shift_cancelled");
  });

  it("every block reason has a label and a structured error code", () => {
    for (const reason of ASSIGNMENT_BLOCK_REASONS) {
      expect(ASSIGNMENT_BLOCK_REASON_LABELS[reason]).toBeTruthy();
      expect(ERROR_CODES[ASSIGNMENT_BLOCK_ERROR[reason]]).toBeDefined();
    }
  });

  it("the conflict message never names another agency or facility", () => {
    expect(ASSIGNMENT_BLOCK_REASON_LABELS.WORKER_SCHEDULE_CONFLICT).toBe(
      "Worker has a scheduling conflict",
    );
    expect(ERROR_CODES.WORKER_SCHEDULE_CONFLICT.message).not.toMatch(/agency|facility/i);
  });
});

describe("shift error mapping", () => {
  it.each([
    ["CHS04", "SHIFT_NOT_FOUND"],
    ["CHS09", "SHIFT_NOT_OPEN"],
    ["CHS10", "RELATIONSHIP_NOT_ACTIVE"],
    ["CHS11", "FACILITY_LOCATION_INVALID"],
    ["CHS12", "DISCIPLINE_MISMATCH"],
    ["CHS13", "WORKER_NOT_ACTIVE"],
    ["CHS14", "WORKER_NOT_ELIGIBLE"],
    ["CHS15", "WORKER_SCHEDULE_CONFLICT"],
    ["CHS16", "SHIFT_FULL"],
    ["CHA04", "ASSIGNMENT_NOT_FOUND"],
    ["CHA09", "ASSIGNMENT_NOT_ACTIONABLE"],
  ])("maps %s to %s", (sqlstate, code) => {
    expect(normalizeError({ code: sqlstate, message: "raw db text" }).code).toBe(code);
  });
});

describe("shift time display (always in the shift's own timezone)", () => {
  it("formats a day shift in the facility timezone", () => {
    const times = {
      startAt: "2030-01-15T12:00:00Z",
      endAt: "2030-01-15T20:00:00Z",
      timezone: "America/New_York",
    };
    expect(formatShiftDate(times)).toBe("Tue, Jan 15, 2030");
    expect(formatShiftTimeRange(times)).toBe("7:00 AM – 3:00 PM EST");
  });

  it("marks overnight shifts and keeps the start date", () => {
    const times = {
      startAt: "2030-07-15T23:00:00Z",
      endAt: "2030-07-16T11:00:00Z",
      timezone: "America/New_York",
    };
    expect(formatShiftTimeRange(times)).toBe("7:00 PM – 7:00 AM (+1 day) EDT");
    expect(localDate(times.startAt, times.timezone)).toBe("2030-07-15");
    expect(shiftDurationHours(times)).toBe(12);
  });

  it("the same instant is a different local date in another timezone", () => {
    expect(localDate("2030-01-16T02:00:00Z", "America/Chicago")).toBe("2030-01-15");
    expect(localDate("2030-01-16T02:00:00Z", "UTC")).toBe("2030-01-16");
  });

  it("DST changes the elapsed duration of a wall-clock 19:00–07:00 shift", () => {
    // Fall back (2030-11-03): 13 hours. Spring forward (2030-03-10): 11 hours.
    expect(
      shiftDurationHours({ startAt: "2030-11-02T23:00:00Z", endAt: "2030-11-03T12:00:00Z" }),
    ).toBe(13);
    expect(
      shiftDurationHours({ startAt: "2030-03-10T00:00:00Z", endAt: "2030-03-10T11:00:00Z" }),
    ).toBe(11);
  });

  it("a shift ending exactly at midnight stays on its start day", () => {
    expect(
      formatShiftTimeRange({
        startAt: "2030-07-17T20:00:00Z",
        endAt: "2030-07-18T04:00:00Z",
        timezone: "America/New_York",
      }),
    ).toBe("4:00 PM – 12:00 AM EDT");
  });
});

describe("discipline display parts", () => {
  it("splits a trailing short code and leaves other names whole", () => {
    expect(disciplineNameParts("Certified Nursing Assistant (CNA)")).toEqual({
      name: "Certified Nursing Assistant",
      code: "CNA",
    });
    expect(disciplineNameParts("Registered Nurse (RN)")).toEqual({
      name: "Registered Nurse",
      code: "RN",
    });
    expect(disciplineNameParts("LPN / LVN")).toEqual({ name: "LPN / LVN", code: null });
  });
});

describe("time range parts and start windows", () => {
  it("splits the range from its zone and rejoins to the full label", () => {
    const times = {
      startAt: "2026-10-06T11:00:00Z",
      endAt: "2026-10-06T19:00:00Z",
      timezone: "America/New_York",
    };
    expect(formatShiftTimeRangeParts(times)).toEqual({ range: "7:00 AM – 3:00 PM", zone: "EDT" });
    expect(formatShiftTimeRange(times)).toBe("7:00 AM – 3:00 PM EDT");
  });

  it("knows whether a shift starts within a window", () => {
    const inHours = (hours: number) => ({
      startAt: new Date(Date.now() + hours * 3_600_000).toISOString(),
    });
    expect(startsWithin(inHours(2), 24)).toBe(true);
    expect(startsWithin(inHours(30), 24)).toBe(false);
    expect(startsWithin(inHours(-1), 24)).toBe(true);
  });
});

describe("local-today and day-count helpers", () => {
  it("knows whether a shift starts today in its own timezone", () => {
    const now = new Date().toISOString();
    expect(startsLocalToday({ startAt: now, timezone: "UTC" })).toBe(true);
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect(startsLocalToday({ startAt: later, timezone: "UTC" })).toBe(false);
  });

  it("counts whole days until a date", () => {
    const inDays = (days: number) =>
      new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    expect(daysUntilDate(inDays(0))).toBe(0);
    expect(daysUntilDate(inDays(20))).toBe(20);
    expect(daysUntilDate(inDays(-2))).toBe(-2);
  });
});
