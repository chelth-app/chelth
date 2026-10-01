import { describe, expect, it } from "vitest";

import { createRequirementSchema, updateRequirementSchema } from "@/features/compliance/schemas";
import { formatCalendarDate, localCalendarDate } from "@/lib/domain/credentials";

const ORG = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";

describe("facility-local default dates (deterministic instants)", () => {
  it("after midnight UTC but before local midnight, New York is still on the previous day", () => {
    expect(localCalendarDate("America/New_York", new Date("2030-03-12T02:30:00Z"))).toBe(
      "2030-03-11",
    );
  });

  it("Chicago likewise, until its own midnight", () => {
    expect(localCalendarDate("America/Chicago", new Date("2030-03-12T04:30:00Z"))).toBe(
      "2030-03-11",
    );
    expect(localCalendarDate("America/Chicago", new Date("2030-03-12T05:30:00Z"))).toBe(
      "2030-03-12",
    );
  });

  it("is DST-safe around the spring-forward night", () => {
    expect(localCalendarDate("America/New_York", new Date("2030-03-10T06:59:00Z"))).toBe(
      "2030-03-10",
    );
    expect(localCalendarDate("America/New_York", new Date("2030-03-10T03:59:00Z"))).toBe(
      "2030-03-09",
    );
  });

  it("formats a calendar date without moving it through the viewer's timezone", () => {
    expect(formatCalendarDate("2030-03-11")).toBe("Mar 11, 2030");
  });
});

describe("requirement date input at the trusted boundary", () => {
  const base = {
    organisationId: ORG,
    credentialTypeKey: "bls_certification",
    minimumValidityDays: "0",
    expiryWarningDays: "30",
  };

  it("requires an explicit effective date", () => {
    expect(createRequirementSchema.safeParse(base).success).toBe(false);
    expect(createRequirementSchema.safeParse({ ...base, effectiveFrom: "" }).success).toBe(false);
  });

  it("keeps the date string exactly as entered (no instant conversion)", () => {
    const parsed = createRequirementSchema.parse({ ...base, effectiveFrom: "2030-03-11" });
    expect(parsed.effectiveFrom).toBe("2030-03-11");
  });

  it("rejects malformed dates", () => {
    for (const value of ["2030-02-30", "11/03/2030", "2030-3-11", "2030-03-11T00:00:00Z"]) {
      expect(createRequirementSchema.safeParse({ ...base, effectiveFrom: value }).success).toBe(
        false,
      );
    }
  });

  it("deactivation needs an explicit last day", () => {
    const update = {
      organisationId: ORG,
      requirementId: REQ,
      mustBeVerified: "true",
      minimumValidityDays: "0",
      expiryWarningDays: "30",
      status: "inactive",
    };
    expect(updateRequirementSchema.safeParse(update).success).toBe(false);
    expect(
      updateRequirementSchema.parse({ ...update, effectiveUntil: "2030-03-11" }).effectiveUntil,
    ).toBe("2030-03-11");
  });
});
