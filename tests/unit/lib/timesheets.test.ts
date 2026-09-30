import { describe, expect, it } from "vitest";

import {
  describeCorrectionTarget,
  REJECTION_RESOLUTIONS,
  zonedLocalToInstant,
} from "@/lib/domain/attendance";
import {
  BLOCKING_REASON_LABELS,
  blockingReasonLabel,
  formatPeriod,
  formatWorkedMinutes,
  periodStartFor,
} from "@/lib/domain/timesheets";
import { ERROR_CODES, normalizeError } from "@/lib/errors";
import { renderNotification } from "@/lib/notifications";

describe("worked time display", () => {
  it("shows whole minutes as hours and minutes, never decimals or money", () => {
    expect(formatWorkedMinutes(453)).toBe("7 h 33 min");
    expect(formatWorkedMinutes(480)).toBe("8 h");
    expect(formatWorkedMinutes(30)).toBe("30 min");
    expect(formatWorkedMinutes(0)).toBe("0 min");
    expect(formatWorkedMinutes(null)).toBe("—");
  });
});

describe("timesheet periods (mirror of internal.period_start_for)", () => {
  it("finds the Monday of a week by default", () => {
    expect(periodStartFor("2030-03-06", 1)).toBe("2030-03-04"); // Wednesday → Monday
    expect(periodStartFor("2030-03-04", 1)).toBe("2030-03-04"); // Monday itself
    expect(periodStartFor("2030-03-10", 1)).toBe("2030-03-04"); // Sunday closes the week
  });

  it("honours a Sunday week start", () => {
    expect(periodStartFor("2030-03-06", 7)).toBe("2030-03-03");
    expect(periodStartFor("2030-03-03", 7)).toBe("2030-03-03");
  });

  it("assigns an overnight shift by its local start date, across a month boundary", () => {
    expect(periodStartFor("2030-03-31", 1)).toBe("2030-03-25");
    expect(periodStartFor("2030-04-01", 1)).toBe("2030-04-01");
  });

  it("formats a period of calendar dates without shifting them across timezones", () => {
    expect(formatPeriod("2030-03-04", "2030-03-10")).toBe("Mon, Mar 4 – Sun, Mar 10, 2030");
  });
});

describe("blocking reasons", () => {
  it("every database reason code has a readable label", () => {
    for (const code of [
      "MISSING_CLOCK_IN",
      "MISSING_CLOCK_OUT",
      "BREAK_NOT_ENDED",
      "TIMES_INCONSISTENT",
      "PENDING_CORRECTION",
      "PERIOD_NOT_ENDED",
      "NO_WORK",
      "UNREVIEWED_EXCEPTION",
    ]) {
      expect(BLOCKING_REASON_LABELS[code]).toBeTruthy();
    }
    expect(blockingReasonLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

describe("corrections with breaks and adjustments", () => {
  it("names which time a correction is about", () => {
    expect(describeCorrectionTarget("clock_in", 1)).toBe("clock-in time");
    expect(describeCorrectionTarget("break_end", 2)).toBe("break 2 end time");
  });

  it("a rejection can never use an approval resolution", () => {
    expect(REJECTION_RESOLUTIONS).not.toContain("approved_as_requested");
    expect(REJECTION_RESOLUTIONS).not.toContain("approved_with_adjustment");
  });

  it("adjusted local times convert in the facility timezone (DST-safe)", () => {
    expect(zonedLocalToInstant("2030-11-03", "06:30", "America/Chicago")).toBe(
      "2030-11-03T12:30:00.000Z",
    );
  });
});

describe("timesheet and break errors", () => {
  it.each([
    ["CHT19", "ALREADY_ON_BREAK"],
    ["CHT20", "NOT_ON_BREAK"],
    ["CHT21", "ON_BREAK"],
    ["CHT22", "TIMESHEET_REVISION_REQUIRED"],
    ["CHP04", "TIMESHEET_NOT_FOUND"],
    ["CHP09", "TIMESHEET_NOT_ACTIONABLE"],
    ["CHP12", "TIMESHEET_ENTRY_NOT_FOUND"],
    ["CHP13", "SIGNOFF_NOT_ACTIONABLE"],
    ["CHP14", "TIMESHEET_REVISION_CONFLICT"],
    ["CHP15", "TIMESHEET_SETTINGS_LOCKED"],
  ])("maps %s to %s", (sqlstate, code) => {
    expect(normalizeError({ code: sqlstate, message: "raw" }).code).toBe(code);
  });

  it("the revision message asks for explicit confirmation", () => {
    expect(ERROR_CODES.TIMESHEET_REVISION_REQUIRED.message).toMatch(/Confirm/);
  });
});

describe("timesheet emails", () => {
  const base = {
    agencyName: "Alpha Care",
    periodStart: "2030-03-04",
    periodEnd: "2030-03-10",
  };

  it("asks a facility to sign off without times, totals or worker detail", () => {
    const rendered = renderNotification(
      {
        ...base,
        event: "timesheet_facility_signoff_required",
        audience: "facility",
        path: "/app/organisations/22222222-2222-4222-8222-222222222222/timesheets",
      },
      "https://app.example",
    );
    expect(rendered.subject).toBe(
      "Timesheet entries to sign off: Alpha Care, Mar 4 – Mar 10, 2030",
    );
    expect(rendered.text).not.toMatch(/\d+ ?h|minutes|latitude|pay|rate/i);
  });

  it("tells a worker their timesheet was returned and how to fix it", () => {
    const rendered = renderNotification(
      {
        ...base,
        event: "timesheet_rejected",
        audience: "worker",
        path: "/app/organisations/11111111-1111-4111-8111-111111111111/timesheets/33333333-3333-4333-8333-333333333333",
      },
      "https://app.example",
    );
    expect(rendered.text).toContain("correction request");
  });

  it("names a reopened timesheet as reopened", () => {
    const rendered = renderNotification(
      {
        ...base,
        event: "timesheet_rejected",
        audience: "worker",
        reopened: true,
        path: "/app/organisations/11111111-1111-4111-8111-111111111111/timesheets/33333333-3333-4333-8333-333333333333",
      },
      "https://app.example",
    );
    expect(rendered.html).toContain("Your timesheet was reopened");
  });
});
