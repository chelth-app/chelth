import { describe, expect, it } from "vitest";

import {
  createPlatformOrganisationSchema,
  customerAccountSchema,
  lifecycleSchema,
  linkFacilitySchema,
  planSchema,
} from "@/features/platform/schemas";

/* P0-E9-4A: control-plane form rules (the database re-validates every one). */

const ORG = "00000000-0000-4000-8000-000000000001";
const RECORD = "00000000-0000-4000-8000-000000000002";

describe("platform organisation provisioning", () => {
  it("needs a type, a name and the owner's email", () => {
    expect(
      createPlatformOrganisationSchema.safeParse({
        type: "facility",
        name: "Lakeside Clinic",
        ownerEmail: "owner@lakeside.test",
      }).success,
    ).toBe(true);
    expect(
      createPlatformOrganisationSchema.safeParse({
        type: "worker",
        name: "X Y",
        ownerEmail: "a@b.co",
      }).success,
    ).toBe(false);
    expect(
      createPlatformOrganisationSchema.safeParse({
        type: "agency",
        name: "A",
        ownerEmail: "a@b.co",
      }).success,
    ).toBe(false);
    expect(
      createPlatformOrganisationSchema.safeParse({
        type: "agency",
        name: "Agency",
        ownerEmail: "nope",
      }).success,
    ).toBe(false);
  });
});

describe("facility links are explicit", () => {
  it("require a chosen record and a confirmation", () => {
    const base = { facilityOrganisationId: ORG, agencyFacilityId: RECORD };
    expect(linkFacilitySchema.safeParse({ ...base, confirm: "on" }).success).toBe(true);
    expect(linkFacilitySchema.safeParse(base).success).toBe(false);
    expect(
      linkFacilitySchema.safeParse({ ...base, agencyFacilityId: "", confirm: "on" }).success,
    ).toBe(false);
  });
});

describe("commercial accounts", () => {
  const valid = { organisationId: ORG, status: "trial", planKey: "pilot", reason: "Pilot start" };

  it("need an explicit status and a reason; optional fields stay absent", () => {
    const parsed = customerAccountSchema.parse(valid);
    expect(parsed).toMatchObject({ status: "trial", planKey: "pilot", cancelAtPeriodEnd: false });
    expect(parsed.billingEmail).toBeUndefined();
    expect(customerAccountSchema.safeParse({ ...valid, status: "" }).success).toBe(false);
    expect(customerAccountSchema.safeParse({ ...valid, reason: "x" }).success).toBe(false);
    expect(
      customerAccountSchema.safeParse({ ...valid, billingEmail: "not-an-email" }).success,
    ).toBe(false);
  });

  it("lifecycle changes need a reason and only toggle access", () => {
    expect(
      lifecycleSchema.safeParse({
        organisationId: ORG,
        status: "suspended",
        reason: "Contract paused",
      }).success,
    ).toBe(true);
    expect(
      lifecycleSchema.safeParse({ organisationId: ORG, status: "archived", reason: "Gone" })
        .success,
    ).toBe(false);
  });
});

describe("plans never invent pricing", () => {
  it("allow an unpriced plan, and require price and currency together", () => {
    expect(planSchema.safeParse({ key: "pilot", name: "Pilot", status: "active" }).success).toBe(
      true,
    );
    expect(
      planSchema.safeParse({ key: "growth", name: "Growth", status: "active", monthlyPrice: "49" })
        .success,
    ).toBe(false);
    expect(
      planSchema.parse({
        key: "growth",
        name: "Growth",
        status: "active",
        monthlyPrice: "49.50",
        currency: "usd",
      }),
    ).toMatchObject({ monthlyPrice: "49.50", currency: "USD" });
    expect(planSchema.safeParse({ key: "Bad Key", name: "Plan", status: "active" }).success).toBe(
      false,
    );
  });
});
