import { describe, expect, it } from "vitest";

import {
  describeOvertime,
  describeRounding,
  formatHourlyRate,
  formatMoney,
  marginMinor,
  minorToDecimalString,
  parseMajorToMinor,
  versionPhase,
} from "@/lib/domain/pricing";
import { ERROR_CODES, normalizeError } from "@/lib/errors";
import { renderNotification } from "@/lib/notifications";

describe("money parsing (exact, minor units)", () => {
  it.each([
    ["42.50", 4250],
    ["42.5", 4250],
    ["42", 4200],
    ["0.01", 1],
    ["1,250.00", 125000],
    [" 58.00 ", 5800],
  ])("parses %s to %i minor units", (input, expected) => {
    expect(parseMajorToMinor(input)).toBe(expected);
  });

  it.each(["", "abc", "-1", "42.505", "4.2.5", "1e3", "0x10"])("rejects %j", (input) => {
    expect(parseMajorToMinor(input)).toBeNull();
  });

  it("never goes through floating point (0.1 + 0.2 style inputs stay exact)", () => {
    expect(parseMajorToMinor("0.29")).toBe(29);
    expect(parseMajorToMinor("1.15")).toBe(115);
    expect(parseMajorToMinor("123456789.99")).toBe(12345678999);
  });
});

describe("money formatting (currency-aware)", () => {
  it("renders minor units as an exact decimal", () => {
    expect(minorToDecimalString(34000)).toBe("340.00");
    expect(minorToDecimalString(32088)).toBe("320.88");
    expect(minorToDecimalString(5)).toBe("0.05");
    expect(minorToDecimalString(-150)).toBe("-1.50");
  });

  it("formats with the currency's own symbol", () => {
    expect(formatMoney(34000, "USD")).toBe("$340.00");
    expect(formatMoney(46400, "CAD")).toBe("CA$464.00");
    expect(formatMoney(123456789, "GBP")).toBe("£1,234,567.89");
    expect(formatHourlyRate(4250, "USD")).toBe("$42.50/h");
  });

  it("derives margin without storing it", () => {
    expect(marginMinor(90190, 66088)).toBe(24102);
  });
});

describe("rate version phases", () => {
  const base = { status: "active" as const, supersededFrom: null };
  it("labels current, upcoming, superseded and ended versions", () => {
    expect(
      versionPhase({ ...base, effectiveFrom: "2030-01-01", periodEnd: null }, "2030-02-01"),
    ).toBe("current");
    expect(
      versionPhase({ ...base, effectiveFrom: "2030-03-01", periodEnd: null }, "2030-02-01"),
    ).toBe("upcoming");
    expect(
      versionPhase(
        {
          status: "active",
          effectiveFrom: "2030-01-01",
          periodEnd: "2030-01-31",
          supersededFrom: "2030-02-01",
        },
        "2030-02-15",
      ),
    ).toBe("superseded");
    expect(
      versionPhase({ ...base, effectiveFrom: "2030-01-01", periodEnd: "2030-01-31" }, "2030-02-15"),
    ).toBe("ended");
    expect(
      versionPhase(
        { status: "draft", effectiveFrom: "2030-01-01", periodEnd: null, supersededFrom: null },
        "2030-02-01",
      ),
    ).toBe("draft");
  });
});

describe("policy descriptions", () => {
  it("describes rounding and overtime without implying legal compliance", () => {
    expect(describeRounding("none", null)).toBe("No rounding");
    expect(describeRounding("nearest", 15)).toBe("Nearest 15 minutes");
    expect(describeOvertime(3, 2, 2400)).toBe("1.5× after 40 h per week");
    expect(describeOvertime(null, null)).toBe("No overtime");
  });
});

describe("pricing errors", () => {
  it.each([
    ["CHM01", "RATE_NOT_CONFIGURED"],
    ["CHM02", "RATE_AMBIGUOUS"],
    ["CHM03", "RATE_NOT_ACTIVE"],
    ["CHM04", "RATE_NOT_FOUND"],
    ["CHM06", "RATE_CURRENCY_MISMATCH"],
    ["CHM07", "TIMESHEET_NOT_LOCKED"],
    ["CHM08", "TIMESHEET_REVISION_CHANGED"],
    ["CHM10", "INVALID_RATE"],
    ["CHM11", "INVALID_EFFECTIVE_PERIOD"],
    ["CHM12", "OVERLAPPING_RATE_VERSION"],
    ["CHM13", "ROUNDING_POLICY_INVALID"],
    ["CHM14", "OVERTIME_POLICY_INVALID"],
    ["CHM15", "PRICING_NOT_FOUND"],
  ])("maps %s to %s", (sqlstate, code) => {
    expect(normalizeError({ code: sqlstate, message: "raw" }).code).toBe(code);
  });

  it("a missing rate says what to do, and never suggests a default", () => {
    expect(ERROR_CODES.RATE_NOT_CONFIGURED.message).toMatch(/Add or activate a rate/);
  });
});

describe("pricing email", () => {
  it("tells finance a timesheet is blocked, without amounts or rates", () => {
    const rendered = renderNotification(
      {
        event: "pricing_blocked_missing_rate",
        audience: "agency",
        path: "/app/organisations/11111111-1111-4111-8111-111111111111/pricing",
        agencyName: "Alpha Care",
        workerName: "Walt",
        periodStart: "2030-03-04",
        periodEnd: "2030-03-10",
      },
      "https://app.example",
    );
    expect(rendered.subject).toBe("Pricing blocked: Walt, Mar 4 – Mar 10, 2030");
    expect(rendered.text).not.toMatch(/\$|USD|rate of|\d+\.\d{2}/);
  });
});
