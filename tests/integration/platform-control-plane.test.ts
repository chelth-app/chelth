import { beforeAll, describe, expect, it } from "vitest";

import { uniqueEmail } from "../support/mailpit";
import {
  grantPlatformAdmin,
  ownerQuery,
  signUpVerified,
  slug,
  stepUpToAal2,
  type TestIdentity,
} from "./support/identities";

/*
 * P0-E9-4A: the platform control plane through the API — facility
 * provisioning with an owner invitation, explicit linking, commercial
 * accounts, and the boundary between platform and tenant data.
 */

async function createAgency(owner: TestIdentity, name: string): Promise<string> {
  const { data, error } = await owner.client.rpc("create_organisation", {
    p_type: "agency",
    p_name: name,
    p_slug: slug("agency"),
  });
  if (error) throw error;
  return data;
}

async function membershipsOf(profileId: string) {
  return ownerQuery(
    (sql) => sql<{ organisation_id: string }[]>`
      select organisation_id from public.organisation_memberships where profile_id = ${profileId}::uuid`,
  );
}

describe("platform control plane (P0-E9-4A)", () => {
  let operator: TestIdentity;
  let alphaAdmin: TestIdentity;
  let betaAdmin: TestIdentity;
  let alphaId: string;
  let betaId: string;
  let facilityOrgId: string;
  let ownerToken: string;
  let ownerEmail: string;
  let alphaFacilityId: string;

  beforeAll(async () => {
    [operator, alphaAdmin, betaAdmin] = await Promise.all([
      signUpVerified("platform-op"),
      signUpVerified("cp-alpha"),
      signUpVerified("cp-beta"),
    ]);
    [alphaId, betaId] = await Promise.all([
      createAgency(alphaAdmin, "Alpha Control Agency"),
      createAgency(betaAdmin, "Beta Control Agency"),
    ]);
    await grantPlatformAdmin(operator.userId);
    await Promise.all([stepUpToAal2(operator), stepUpToAal2(alphaAdmin), stepUpToAal2(betaAdmin)]);
    const facility = await alphaAdmin.client.rpc("create_agency_facility", {
      p_agency_organisation_id: alphaId,
      p_name: "Mercy Control",
      p_facility_type: "rehabilitation",
      p_timezone: "America/New_York",
    });
    if (facility.error) throw facility.error;
    alphaFacilityId = facility.data;
    const relationship = await alphaAdmin.client.rpc("create_facility_relationship", {
      p_facility_id: alphaFacilityId,
    });
    if (relationship.error) throw relationship.error;
    const active = await alphaAdmin.client.rpc("set_facility_relationship_status", {
      p_relationship_id: relationship.data,
      p_status: "active",
    });
    if (active.error) throw active.error;
  });

  it("ordinary users cannot use the control plane", async () => {
    for (const who of [alphaAdmin, betaAdmin]) {
      const { error } = await who.client.rpc("platform_get_overview");
      expect(error?.code).toBe("CH403");
    }
  });

  it("creates a facility organisation with an owner invitation; the operator never becomes a member", async () => {
    ownerEmail = uniqueEmail("cp-facility-owner");
    const created = await operator.client.rpc("platform_create_organisation", {
      p_type: "facility",
      p_name: "Omega Control Clinic",
      p_slug: slug("omega"),
      p_owner_email: ownerEmail,
    });
    expect(created.error).toBeNull();
    facilityOrgId = created.data?.[0]?.organisation_id ?? "";
    ownerToken = created.data?.[0]?.invite_token ?? "";
    expect(await membershipsOf(operator.userId)).toEqual([]);

    const detail = await operator.client.rpc("platform_get_customer", {
      p_organisation_id: facilityOrgId,
    });
    const invites = (detail.data as { invites: { status: string; email: string }[] }).invites;
    expect(invites).toEqual([expect.objectContaining({ status: "pending", email: ownerEmail })]);
  });

  it("the invited owner accepts and becomes the facility admin", async () => {
    const owner = await signUpVerified("cp-facility-owner", ownerEmail);
    const accepted = await owner.client.rpc("accept_organisation_invite", { p_token: ownerToken });
    expect(accepted.error).toBeNull();
    const [role] = await ownerQuery(
      (sql) => sql<{ role_key: string }[]>`
        select r.role_key from public.membership_roles r
        join public.organisation_memberships m on m.id = r.membership_id
        where m.profile_id = ${owner.userId}::uuid and m.organisation_id = ${facilityOrgId}::uuid
          and r.revoked_at is null`,
    );
    expect(role?.role_key).toBe("facility.admin");
    expect(await membershipsOf(operator.userId)).toEqual([]);

    // Link: explicit, by the platform only; then the facility sees its agency.
    const refused = await betaAdmin.client.rpc("platform_link_agency_facility", {
      p_agency_facility_id: alphaFacilityId,
      p_facility_organisation_id: facilityOrgId,
    });
    expect(refused.error?.code).toBe("CH403");
    const betaSees = await betaAdmin.client
      .from("agency_facilities")
      .select("id")
      .eq("id", alphaFacilityId);
    expect(betaSees.data).toEqual([]);

    const linked = await operator.client.rpc("platform_link_agency_facility", {
      p_agency_facility_id: alphaFacilityId,
      p_facility_organisation_id: facilityOrgId,
    });
    expect(linked.error).toBeNull();
    const again = await operator.client.rpc("platform_link_agency_facility", {
      p_agency_facility_id: alphaFacilityId,
      p_facility_organisation_id: facilityOrgId,
    });
    expect(again.error?.code).toBe("CHF09");

    const partners = await owner.client.rpc("list_partner_agency_relationships", {
      p_facility_organisation_id: facilityOrgId,
    });
    expect(partners.data?.map((row) => row.agency_name)).toEqual(["Alpha Control Agency"]);
    const outsider = await betaAdmin.client.rpc("list_partner_agency_relationships", {
      p_facility_organisation_id: facilityOrgId,
    });
    expect(outsider.error?.code).toBe("CH403");
  });

  it("manages commercial accounts without touching tenant data", async () => {
    const list = await operator.client.rpc("platform_list_customers");
    expect(list.data?.find((row) => row.organisation_id === alphaId)?.account_status).toBeNull();

    const trial = await operator.client.rpc("platform_save_customer_account", {
      p_organisation_id: alphaId,
      p_status: "trial",
      p_reason: "pilot onboarding",
      p_plan_key: "pilot",
      p_billing_name: "Alpha Finance",
      p_billing_email: "billing@alpha.test",
      p_trial_ends_on: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
    });
    expect(trial.error).toBeNull();
    const active = await operator.client.rpc("platform_save_customer_account", {
      p_organisation_id: alphaId,
      p_status: "active",
      p_reason: "pilot converted",
      p_plan_key: "pilot",
      p_billing_name: "Alpha Finance",
      p_billing_email: "billing@alpha.test",
    });
    expect(active.error).toBeNull();
    const after = await operator.client.rpc("platform_list_customers");
    const row = after.data?.find((candidate) => candidate.organisation_id === alphaId);
    expect(row).toMatchObject({ account_status: "active", plan_key: "pilot", status: "active" });

    // The agency itself cannot read or change Chelth billing records.
    const own = await alphaAdmin.client.from("customer_accounts" as never).select("*");
    expect(own.error).not.toBeNull();
  });

  it("keeps tenant finance invisible to the platform admin", async () => {
    const card = await alphaAdmin.client.rpc("create_rate_card", {
      p_organisation_id: alphaId,
      p_discipline_key: "cna",
    });
    expect(card.error).toBeNull();
    for (const table of ["rate_cards", "rate_card_versions", "payroll_batches", "invoice_drafts"]) {
      const { data } = await operator.client.from(table as "rate_cards").select("id");
      expect(data ?? [], table).toEqual([]);
    }
    const rpc = await operator.client.rpc("list_rate_cards", { p_organisation_id: alphaId });
    expect(rpc.error?.code).toBe("CH403");
    expect(betaId).toBeTruthy();
  });
});
