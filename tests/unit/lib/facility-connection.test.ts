import { describe, expect, it } from "vitest";

import { buildFacilityConnectionEmail } from "@/features/facilities/emails/facility-connection-email";
import {
  acceptFacilityConnectionSchema,
  inviteFacilityConnectionSchema,
} from "@/features/facilities/schemas";

/* P0-E9-4A.1: agency-initiated facility connection (the database re-validates). */

const ORG = "00000000-0000-4000-8000-000000000001";
const FACILITY = "00000000-0000-4000-8000-000000000002";

describe("agency invitation form", () => {
  it("needs the administrator's email; the contact name is optional", () => {
    expect(
      inviteFacilityConnectionSchema.safeParse({
        organisationId: ORG,
        facilityId: FACILITY,
        email: "admin@metro.org",
      }).success,
    ).toBe(true);
    expect(
      inviteFacilityConnectionSchema.safeParse({
        organisationId: ORG,
        facilityId: FACILITY,
        email: "not-an-email",
      }).success,
    ).toBe(false);
  });
});

describe("facility acceptance", () => {
  it("connecting needs the chosen facility; creating does not", () => {
    expect(
      acceptFacilityConnectionSchema.safeParse({ mode: "create", confirm: "on" }).success,
    ).toBe(true);
    expect(
      acceptFacilityConnectionSchema.safeParse({ mode: "connect", confirm: "on" }).success,
    ).toBe(false);
    expect(
      acceptFacilityConnectionSchema.safeParse({
        mode: "connect",
        facilityOrganisationId: ORG,
        confirm: "on",
      }).success,
    ).toBe(true);
  });

  it("always needs explicit confirmation", () => {
    expect(acceptFacilityConnectionSchema.safeParse({ mode: "create" }).success).toBe(false);
  });
});

describe("connection email", () => {
  const email = buildFacilityConnectionEmail({
    to: "admin@metro.org",
    agencyName: "Victor <Test> Agency",
    facilityName: "Metro Health",
    inviteUrl: "https://app.chelth.com/invite/abc",
    expiresAt: "2026-10-20T00:00:00Z",
    idempotencyKey: "facility-connection-1",
  });

  it("names the agency and facility and links to the invitation", () => {
    expect(email.subject).toBe(
      "Victor <Test> Agency would like to connect with Metro Health on Chelth",
    );
    expect(email.text).toContain("Review the invitation: https://app.chelth.com/invite/abc");
    expect(email.html).toContain("Victor &lt;Test&gt; Agency");
    expect(email.html).not.toContain("<Test>");
  });

  it("carries no internal identifiers, rates or worker data", () => {
    expect(`${email.text} ${email.html}`).not.toMatch(
      /rate|worker record|payroll|[0-9a-f]{8}-[0-9a-f]{4}/i,
    );
  });
});
