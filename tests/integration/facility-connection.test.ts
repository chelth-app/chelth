import { beforeAll, describe, expect, it } from "vitest";

import { uniqueEmail } from "../support/mailpit";
import { isoDay } from "./support/staffing";
import { signUpVerified, slug, stepUpToAal2, type TestIdentity } from "./support/identities";

/*
 * P0-E9-4A.1: agency-initiated facility onboarding and one facility served by
 * several agencies, through the API (two-party consent, isolation, routing).
 */

async function agencyWithFacility(
  admin: TestIdentity,
  name: string,
): Promise<{ agencyId: string; facilityId: string; locationId: string }> {
  const agency = await admin.client.rpc("create_organisation", {
    p_type: "agency",
    p_name: name,
    p_slug: slug("agency"),
  });
  if (agency.error) throw agency.error;
  await stepUpToAal2(admin);
  const facility = await admin.client.rpc("create_agency_facility", {
    p_agency_organisation_id: agency.data,
    p_name: "Metro Health",
    p_facility_type: "hospital",
    p_timezone: "America/New_York",
  });
  if (facility.error) throw facility.error;
  const location = await admin.client.rpc("create_facility_location", {
    p_facility_id: facility.data,
    p_name: "Main Campus",
    p_timezone: "America/New_York",
  });
  if (location.error) throw location.error;
  return { agencyId: agency.data, facilityId: facility.data, locationId: location.data };
}

describe("agency-initiated facility connection (P0-E9-4A.1)", () => {
  let alphaAdmin: TestIdentity;
  let bravoAdmin: TestIdentity;
  let metroAdmin: TestIdentity;
  let alpha: { agencyId: string; facilityId: string; locationId: string };
  let bravo: { agencyId: string; facilityId: string; locationId: string };
  let metroId: string;
  const metroEmail = uniqueEmail("metro-admin");

  beforeAll(async () => {
    [alphaAdmin, bravoAdmin] = await Promise.all([
      signUpVerified("conn-alpha"),
      signUpVerified("conn-bravo"),
    ]);
    [alpha, bravo] = await Promise.all([
      agencyWithFacility(alphaAdmin, "Alpha Connect Staffing"),
      agencyWithFacility(bravoAdmin, "Bravo Connect Staffing"),
    ]);
  });

  it("Agency A invites; a new person signs up and creates the facility", async () => {
    const invited = await alphaAdmin.client.rpc("invite_facility_connection", {
      p_facility_id: alpha.facilityId,
      p_email: metroEmail,
    });
    expect(invited.error).toBeNull();
    const token = invited.data?.[0]?.invite_token ?? "";

    const stranger = await signUpVerified("conn-stranger");
    const refused = await stranger.client.rpc("accept_facility_connection_invite", {
      p_token: token,
      p_mode: "create",
    });
    expect(refused.error?.code).toBe("CH404");

    metroAdmin = await signUpVerified("metro-admin", metroEmail);
    const preview = await metroAdmin.client.rpc("preview_facility_connection_invite", {
      p_token: token,
    });
    expect(preview.data).toMatchObject({ agency_name: "Alpha Connect Staffing", options: [] });
    const accepted = await metroAdmin.client.rpc("accept_facility_connection_invite", {
      p_token: token,
      p_mode: "create",
    });
    expect(accepted.error).toBeNull();
    expect(accepted.data?.[0]?.created).toBe(true);
    metroId = accepted.data?.[0]?.facility_organisation_id ?? "";

    const replay = await metroAdmin.client.rpc("accept_facility_connection_invite", {
      p_token: token,
      p_mode: "create",
    });
    expect(replay.error?.code).toBe("CH404");

    const listed = await alphaAdmin.client.rpc("list_facility_connection_invites", {
      p_facility_id: alpha.facilityId,
    });
    expect(listed.data?.[0]).toMatchObject({
      status: "accepted",
      facility_organisation_name: "Metro Health",
    });
    expect(listed.data?.[0]?.masked_email).not.toBe(metroEmail);
  });

  it("Agency B invites the same admin, who connects the EXISTING facility (no duplicate)", async () => {
    const invited = await bravoAdmin.client.rpc("invite_facility_connection", {
      p_facility_id: bravo.facilityId,
      p_email: metroEmail,
    });
    expect(invited.error).toBeNull();
    const token = invited.data?.[0]?.invite_token ?? "";
    const preview = await metroAdmin.client.rpc("preview_facility_connection_invite", {
      p_token: token,
    });
    expect((preview.data as { options: { name: string; can_approve: boolean }[] }).options).toEqual(
      [expect.objectContaining({ name: "Metro Health", can_approve: true })],
    );

    const atAal1 = await metroAdmin.client.rpc("accept_facility_connection_invite", {
      p_token: token,
      p_mode: "connect",
      p_facility_organisation_id: metroId,
    });
    expect(atAal1.error?.code).toBe("CH402");
    await stepUpToAal2(metroAdmin);
    const connected = await metroAdmin.client.rpc("accept_facility_connection_invite", {
      p_token: token,
      p_mode: "connect",
      p_facility_organisation_id: metroId,
    });
    expect(connected.error).toBeNull();
    expect(connected.data?.[0]).toMatchObject({
      facility_organisation_id: metroId,
      created: false,
    });

    const partners = await metroAdmin.client.rpc("list_partner_agency_relationships", {
      p_facility_organisation_id: metroId,
    });
    expect(partners.data?.map((row) => row.agency_name).sort()).toEqual([
      "Alpha Connect Staffing",
      "Bravo Connect Staffing",
    ]);
  });

  it("routes each request to one agency and keeps the agencies apart", async () => {
    const options = async (relationshipFor: TestIdentity, facilityId: string) => {
      const { data } = await relationshipFor.client
        .from("agency_facility_relationships")
        .select("id")
        .eq("agency_facility_id", facilityId)
        .neq("status", "ended");
      return data?.[0]?.id ?? "";
    };
    const alphaRelationship = await options(alphaAdmin, alpha.facilityId);
    const bravoRelationship = await options(bravoAdmin, bravo.facilityId);

    const toBravo = await metroAdmin.client.rpc("submit_facility_shift_request", {
      p_relationship_id: bravoRelationship,
      p_facility_location_id: bravo.locationId,
      p_discipline_key: "cna",
      p_shift_date: isoDay(6),
      p_start_time: "07:00",
      p_end_time: "15:00",
      p_requested_headcount: 1,
    });
    expect(toBravo.error).toBeNull();
    const toAlpha = await metroAdmin.client.rpc("submit_facility_shift_request", {
      p_relationship_id: alphaRelationship,
      p_facility_location_id: alpha.locationId,
      p_discipline_key: "cna",
      p_shift_date: isoDay(6),
      p_start_time: "07:00",
      p_end_time: "15:00",
      p_requested_headcount: 1,
    });
    expect(toAlpha.error).toBeNull();

    const bravoSees = await bravoAdmin.client.from("shifts").select("id");
    const alphaSees = await alphaAdmin.client.from("shifts").select("id");
    expect(bravoSees.data?.map((row) => row.id)).toEqual([toBravo.data]);
    expect(alphaSees.data?.map((row) => row.id)).toEqual([toAlpha.data]);

    // Cross-agency: no records, relationships or invitations of the other agency.
    const alphaReadsBravo = await alphaAdmin.client
      .from("agency_facilities")
      .select("id")
      .eq("id", bravo.facilityId);
    expect(alphaReadsBravo.data).toEqual([]);
    const alphaRelationships = await alphaAdmin.client
      .from("agency_facility_relationships")
      .select("id, agency_organisation_id");
    expect(
      alphaRelationships.data?.every((row) => row.agency_organisation_id === alpha.agencyId),
    ).toBe(true);
    const peek = await alphaAdmin.client.rpc("list_facility_connection_invites", {
      p_facility_id: bravo.facilityId,
    });
    expect(peek.error?.code).toBe("CH403");
    // Agency B cannot route a request through Agency A's relationship either.
    const hijack = await bravoAdmin.client.rpc("submit_facility_shift_request", {
      p_relationship_id: alphaRelationship,
      p_facility_location_id: alpha.locationId,
      p_discipline_key: "cna",
      p_shift_date: isoDay(6),
      p_start_time: "07:00",
      p_end_time: "15:00",
      p_requested_headcount: 1,
    });
    expect(hijack.error).not.toBeNull();
  });
});
