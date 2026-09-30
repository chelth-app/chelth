import { beforeAll, describe, expect, it } from "vitest";

import { uniqueEmail } from "../support/mailpit";
import {
  grantPlatformAdmin,
  signUpVerified,
  slug,
  stepUpToAal2,
  type TestClient,
  type TestIdentity,
} from "./support/identities";

async function createAgency(owner: TestIdentity, name: string): Promise<string> {
  const { data, error } = await owner.client.rpc("create_organisation", {
    p_type: "agency",
    p_name: name,
    p_slug: slug("agency"),
  });
  if (error) throw error;
  return data;
}

async function invite(
  client: TestClient,
  organisationId: string,
  email: string,
  roleKey: string,
): Promise<string> {
  const { data, error } = await client.rpc("create_organisation_invite", {
    p_organisation_id: organisationId,
    p_email: email,
    p_role_key: roleKey,
  });
  if (error) throw error;
  return data[0]?.invite_token ?? "";
}

async function accept(identity: TestIdentity, token: string): Promise<void> {
  const { data, error } = await identity.client.rpc("accept_organisation_invite", {
    p_token: token,
  });
  if (error) throw error;
  if (!data[0]) throw new Error("invitation not accepted");
}

describe("workforce, facilities and relationships (P0-E3-S3)", () => {
  let alphaAdmin: TestIdentity;
  let betaAdmin: TestIdentity;
  let worker: TestIdentity;
  let alphaId: string;
  let betaId: string;
  const workerEmail = uniqueEmail("worker");

  beforeAll(async () => {
    [alphaAdmin, betaAdmin] = await Promise.all([
      signUpVerified("alpha-admin"),
      signUpVerified("beta-admin"),
    ]);
    [alphaId, betaId] = await Promise.all([
      createAgency(alphaAdmin, "Alpha Staffing"),
      createAgency(betaAdmin, "Beta Staffing"),
    ]);
    await Promise.all([stepUpToAal2(alphaAdmin), stepUpToAal2(betaAdmin)]);

    const alphaToken = await invite(
      alphaAdmin.client,
      alphaId,
      workerEmail,
      "agency.healthcare_worker",
    );
    worker = await signUpVerified("worker", workerEmail);
    await accept(worker, alphaToken);
    await accept(
      worker,
      await invite(betaAdmin.client, betaId, workerEmail, "agency.healthcare_worker"),
    );
  });

  describe("workers", () => {
    it("accepting a healthcare-worker invitation creates an onboarding worker record", async () => {
      const { data } = await worker.client
        .from("agency_workers")
        .select("agency_organisation_id, status, profile_id")
        .eq("agency_organisation_id", alphaId);
      expect(data).toEqual([
        { agency_organisation_id: alphaId, status: "onboarding", profile_id: worker.userId },
      ]);
    });

    it("the same person participates separately in a second agency", async () => {
      const { data } = await worker.client
        .from("agency_workers")
        .select("agency_organisation_id, profile_id");
      expect(new Set(data?.map((row) => row.agency_organisation_id))).toEqual(
        new Set([alphaId, betaId]),
      );
      expect(new Set(data?.map((row) => row.profile_id))).toEqual(new Set([worker.userId]));
    });

    it("Agency A cannot see or change Agency B's worker record", async () => {
      const betaRecord = await betaAdmin.client
        .from("agency_workers")
        .select("id")
        .eq("agency_organisation_id", betaId)
        .single();
      const seenByAlpha = await alphaAdmin.client
        .from("agency_workers")
        .select("id")
        .eq("id", betaRecord.data?.id ?? "");
      expect(seenByAlpha.data).toEqual([]);
      const changed = await alphaAdmin.client.rpc("set_agency_worker_status", {
        p_worker_id: betaRecord.data?.id ?? "",
        p_status: "active",
      });
      expect(changed.error?.code).toBe("CH403");
    });

    it("the worker sees only their own records and cannot change their status", async () => {
      const own = await worker.client
        .from("agency_workers")
        .select("id")
        .eq("agency_organisation_id", alphaId)
        .single();
      await stepUpToAal2(worker);
      const selfChange = await worker.client.rpc("set_agency_worker_status", {
        p_worker_id: own.data?.id ?? "",
        p_status: "active",
      });
      expect(selfChange.error?.code).toBe("CH403");
      const notes = await worker.client.from("agency_worker_notes").select("id");
      expect(notes.data).toEqual([]);
    });

    it("the agency activates the worker and the worker sees the change", async () => {
      const record = await alphaAdmin.client
        .from("agency_workers")
        .select("id")
        .eq("agency_organisation_id", alphaId)
        .single();
      const activated = await alphaAdmin.client.rpc("set_agency_worker_status", {
        p_worker_id: record.data?.id ?? "",
        p_status: "active",
      });
      expect(activated.error).toBeNull();
      const seen = await worker.client
        .from("agency_workers")
        .select("status")
        .eq("agency_organisation_id", alphaId)
        .single();
      expect(seen.data?.status).toBe("active");
    });
  });

  describe("invitation delivery state", () => {
    it("records the delivery outcome, only for those with invite authority", async () => {
      const email = uniqueEmail("delivery");
      await invite(alphaAdmin.client, alphaId, email, "agency.scheduler");
      const listed = await alphaAdmin.client.rpc("list_organisation_invites", {
        p_organisation_id: alphaId,
      });
      const created = listed.data?.find((row) => row.invitee_email === email);
      expect(created?.invite_delivery_status).toBe("not_attempted");

      const byOutsider = await betaAdmin.client.rpc("record_organisation_invite_delivery", {
        p_invite_id: created?.invite_id ?? "",
        p_status: "sent",
        p_provider: "resend",
      });
      expect(byOutsider.error?.code).toBe("CH403");

      const recorded = await alphaAdmin.client.rpc("record_organisation_invite_delivery", {
        p_invite_id: created?.invite_id ?? "",
        p_status: "skipped",
        p_provider: "disabled",
      });
      expect(recorded.error).toBeNull();
      const after = await alphaAdmin.client.rpc("list_organisation_invites", {
        p_organisation_id: alphaId,
      });
      expect(
        after.data?.find((row) => row.invite_id === created?.invite_id)?.invite_delivery_status,
      ).toBe("skipped");
    });
  });

  describe("facilities, relationships and explicit cross-organisation sharing", () => {
    let facilityId: string;
    let relationshipId: string;
    let facilityOrgAdmin: TestIdentity;
    let facilityOrgId: string;

    beforeAll(async () => {
      const created = await alphaAdmin.client.rpc("create_agency_facility", {
        p_agency_organisation_id: alphaId,
        p_name: "St Luke's Hospital",
        p_facility_type: "hospital",
        p_timezone: "Europe/London",
        p_email: "Staffing.Office@example.test",
      });
      if (created.error) throw created.error;
      facilityId = created.data;
      const relationship = await alphaAdmin.client.rpc("create_facility_relationship", {
        p_facility_id: facilityId,
      });
      if (relationship.error) throw relationship.error;
      relationshipId = relationship.data;
      const activated = await alphaAdmin.client.rpc("set_facility_relationship_status", {
        p_relationship_id: relationshipId,
        p_status: "active",
      });
      if (activated.error) throw activated.error;

      // A real facility organisation: created by a platform admin, joined by
      // its own administrator through the verified invitation flow.
      const platformAdmin = await signUpVerified("platform");
      await grantPlatformAdmin(platformAdmin.userId);
      await stepUpToAal2(platformAdmin);
      const facilityOwnerEmail = uniqueEmail("facility-owner");
      const facilityOrg = await platformAdmin.client.rpc("platform_create_organisation", {
        p_type: "facility",
        p_name: "St Luke's Hospital Trust",
        p_slug: slug("st-lukes"),
        p_owner_email: facilityOwnerEmail,
      });
      if (facilityOrg.error) throw facilityOrg.error;
      facilityOrgId = facilityOrg.data[0]?.organisation_id ?? "";
      facilityOrgAdmin = await signUpVerified("facility-owner", facilityOwnerEmail);
      await accept(facilityOrgAdmin, facilityOrg.data[0]?.invite_token ?? "");

      // Before linking, the facility organisation sees no relationship.
      const beforeLink = await facilityOrgAdmin.client
        .from("agency_facility_relationships")
        .select("id");
      expect(beforeLink.data).toEqual([]);

      const linked = await platformAdmin.client.rpc("platform_link_agency_facility", {
        p_agency_facility_id: facilityId,
        p_facility_organisation_id: facilityOrgId,
      });
      if (linked.error) throw linked.error;
    });

    it("the agency sees its facility; another agency does not", async () => {
      const own = await alphaAdmin.client
        .from("agency_facilities")
        .select("email")
        .eq("id", facilityId)
        .single();
      expect(own.data?.email).toBe("staffing.office@example.test");
      const other = await betaAdmin.client
        .from("agency_facilities")
        .select("id")
        .eq("id", facilityId);
      expect(other.data).toEqual([]);
    });

    it("the linked facility organisation sees exactly its relationship, through the shared projection", async () => {
      const partners = await facilityOrgAdmin.client.rpc("list_partner_agency_relationships", {
        p_facility_organisation_id: facilityOrgId,
      });
      expect(partners.data).toEqual([
        expect.objectContaining({
          relationship_id: relationshipId,
          agency_name: "Alpha Staffing",
          relationship_status: "active",
        }),
      ]);
      const relationshipRows = await facilityOrgAdmin.client
        .from("agency_facility_relationships")
        .select("id");
      expect(relationshipRows.data?.map((row) => row.id)).toEqual([relationshipId]);
    });

    it("linking grants no access to agency tenant data", async () => {
      const [facilities, workers, locations, agencyOrg] = await Promise.all([
        facilityOrgAdmin.client.from("agency_facilities").select("id"),
        facilityOrgAdmin.client.from("agency_workers").select("id"),
        facilityOrgAdmin.client.from("facility_locations").select("id"),
        facilityOrgAdmin.client.from("organisations").select("id").eq("id", alphaId),
      ]);
      expect([facilities.data, workers.data, locations.data, agencyOrg.data]).toEqual([
        [],
        [],
        [],
        [],
      ]);
    });

    it("ending the relationship ends the sharing", async () => {
      const ended = await alphaAdmin.client.rpc("set_facility_relationship_status", {
        p_relationship_id: relationshipId,
        p_status: "ended",
      });
      expect(ended.error).toBeNull();
      const partners = await facilityOrgAdmin.client.rpc("list_partner_agency_relationships", {
        p_facility_organisation_id: facilityOrgId,
      });
      expect(partners.data).toEqual([]);
    });
  });

  describe("membership suspension", () => {
    it("removes the worker's access to that agency's record immediately", async () => {
      const membership = await alphaAdmin.client
        .from("organisation_memberships")
        .select("id")
        .eq("organisation_id", alphaId)
        .eq("profile_id", worker.userId)
        .single();
      const suspended = await alphaAdmin.client.rpc("set_membership_status", {
        p_membership_id: membership.data?.id ?? "",
        p_status: "suspended",
      });
      expect(suspended.error).toBeNull();
      const visible = await worker.client.from("agency_workers").select("agency_organisation_id");
      expect(visible.data?.map((row) => row.agency_organisation_id)).toEqual([betaId]);
    });
  });
});
