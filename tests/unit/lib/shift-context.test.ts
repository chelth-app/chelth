import { describe, expect, it } from "vitest";

import {
  directionsDestination,
  formatAddressLines,
  formatShiftLength,
  shiftPeriod,
} from "@/lib/domain/shifts";

const NY = "America/New_York";
// 2026-10-10 15:00 UTC = 11:00 in New York.
const NOW = new Date("2026-10-10T15:00:00Z");

describe("shiftPeriod (facility-local Today / Upcoming / Past)", () => {
  const shift = (startAt: string, endAt: string, timezone = NY) => ({ startAt, endAt, timezone });

  it("today: starts on the facility's current date (earlier, now or later)", () => {
    expect(shiftPeriod(shift("2026-10-10T11:00:00Z", "2026-10-10T19:00:00Z"), NOW)).toBe("today");
    expect(shiftPeriod(shift("2026-10-10T22:00:00Z", "2026-10-11T06:00:00Z"), NOW)).toBe("today");
  });

  it("today: a night shift that began yesterday and is still running", () => {
    expect(shiftPeriod(shift("2026-10-10T01:00:00Z", "2026-10-10T16:00:00Z"), NOW)).toBe("today");
  });

  it("uses the facility's date, not UTC: 23:30 local on the 10th is still today", () => {
    // 2026-10-11T03:30Z is 23:30 on Oct 10 in New York.
    expect(shiftPeriod(shift("2026-10-11T03:30:00Z", "2026-10-11T11:30:00Z"), NOW)).toBe("today");
    // ...but tomorrow in UTC.
    expect(shiftPeriod(shift("2026-10-11T03:30:00Z", "2026-10-11T11:30:00Z", "UTC"), NOW)).toBe(
      "upcoming",
    );
  });

  it("upcoming and past", () => {
    expect(shiftPeriod(shift("2026-10-12T11:00:00Z", "2026-10-12T19:00:00Z"), NOW)).toBe(
      "upcoming",
    );
    expect(shiftPeriod(shift("2026-10-08T11:00:00Z", "2026-10-08T19:00:00Z"), NOW)).toBe("past");
  });
});

describe("shift context formatting", () => {
  const address = {
    line1: "123 Healthway Drive",
    line2: null,
    locality: "Atlanta",
    region: "GA",
    postalCode: "30309",
    countryCode: "US",
  };

  it("formats the length", () => {
    expect(
      formatShiftLength({ startAt: "2026-10-10T11:00:00Z", endAt: "2026-10-10T19:00:00Z" }),
    ).toBe("8 hours");
    expect(
      formatShiftLength({ startAt: "2026-10-10T11:00:00Z", endAt: "2026-10-10T18:30:00Z" }),
    ).toBe("7 h 30 min");
  });

  it("formats address lines and a destination-only query", () => {
    expect(formatAddressLines(address)).toEqual(["123 Healthway Drive", "Atlanta, GA 30309"]);
    expect(directionsDestination(address, "Riverside")).toBe(
      "123 Healthway Drive, Atlanta, GA 30309, US",
    );
    expect(
      directionsDestination(
        {
          line1: null,
          line2: null,
          locality: null,
          region: null,
          postalCode: null,
          countryCode: null,
        },
        "Riverside Medical Center",
      ),
    ).toBe("Riverside Medical Center");
  });
});
