import { beforeAll, describe, expect, it } from "vitest";

import { uniqueEmail } from "../support/mailpit";
import { signUpVerified, stepUpToAal2, type TestIdentity } from "./support/identities";
import {
  activateCna,
  assign,
  blsEvidence,
  createAgency,
  facilityWithRelationship,
  invite,
  isoDay,
  must,
  run,
  workerIdAt,
} from "./support/staffing";

/**
 * P0-E7-S1A: credential-requirement effectiveness is decided by facility-LOCAL
 * calendar dates, never by the database's UTC date. Reproduces the discovered
 * failure window deterministically: an evening shift in Chicago (20:00–23:00
 * local on day D) is 01:00–04:00 UTC on day D + 1. No assertion depends on the
 * wall clock.
 */

const TZ = "America/Chicago";

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

describe("local-date requirement effectiveness (P0-E7-S1A)", () => {
  let admin: TestIdentity;
  let scheduler: TestIdentity;
  let otherAdmin: TestIdentity;
  let agencyId: string;
  let otherAgencyId: string;
  let river: { facilityId: string; locationId: string; relationshipId: string };
  const workers: { identity: TestIdentity; id: string }[] = [];
  const day = isoDay(20); // facility-local date D of the evening shift

  beforeAll(async () => {
    [admin, otherAdmin] = await Promise.all([
      signUpVerified("ld-alpha"),
      signUpVerified("ld-beta"),
    ]);
    agencyId = await createAgency(admin, "Alpha Local Date Staffing");
    otherAgencyId = await createAgency(otherAdmin, "Beta Local Date Staffing");
    await Promise.all([stepUpToAal2(admin), stepUpToAal2(otherAdmin)]);
    scheduler = await invite(
      admin.client,
      agencyId,
      "agency.scheduler",
      uniqueEmail("ld-scheduler"),
    );
    await run(
      admin.client.rpc("create_credential_requirement", {
        p_agency_organisation_id: agencyId,
        p_credential_type_key: "bls_certification",
        p_effective_from: isoDay(-30),
      }),
    );
    for (const name of ["one", "two"]) {
      const identity = await invite(
        admin.client,
        agencyId,
        "agency.healthcare_worker",
        uniqueEmail(`ld-${name}`),
      );
      const id = await workerIdAt(identity, agencyId);
      await activateCna(admin.client, id);
      await blsEvidence(identity, 400, [{ client: admin.client, organisationId: agencyId }]);
      workers.push({ identity, id });
    }
    river = await facilityWithRelationship(admin.client, agencyId, "Riverside", TZ);
  }, 240_000);

  function worker(index: number) {
    const value = workers[index];
    if (!value) throw new Error("missing worker");
    return value;
  }

  it("a requirement effective from the shift's UTC date does not apply to the local-day shift", async () => {
    const shiftId = await must(
      scheduler.client.rpc("create_shift", {
        p_agency_facility_id: river.facilityId,
        p_facility_location_id: river.locationId,
        p_discipline_key: "cna",
        p_shift_date: day,
        p_start_time: "20:00",
        p_end_time: "23:00",
        p_requested_headcount: 2,
        p_open: true,
      }),
    );
    const [shift] = await must(admin.client.from("shifts").select("start_at").eq("id", shiftId));
    expect(new Date(shift?.start_at ?? "").toISOString().slice(0, 10)).toBe(addDays(day, 1));

    // Effective from D + 1 (the UTC date): not yet in force on local day D.
    const utcDated = await must(
      admin.client.rpc("create_credential_requirement", {
        p_agency_organisation_id: agencyId,
        p_credential_type_key: "facility_orientation",
        p_effective_from: addDays(day, 1),
        p_agency_facility_id: river.facilityId,
      }),
    );
    const first = await assign(scheduler.client, shiftId, worker(0).id);
    expect(first.outcome).toBe("allowed");

    // Replace it with one effective from the facility-local date D: now it applies.
    await run(
      admin.client.rpc("update_credential_requirement", {
        p_requirement_id: utcDated,
        p_must_be_verified: true,
        p_minimum_validity_days: 0,
        p_expiry_warning_days: 30,
        p_status: "inactive",
        p_effective_until: addDays(day, 1),
      }),
    );
    await run(
      admin.client.rpc("create_credential_requirement", {
        p_agency_organisation_id: agencyId,
        p_credential_type_key: "facility_orientation",
        p_effective_from: day,
        p_agency_facility_id: river.facilityId,
      }),
    );
    const second = await assign(scheduler.client, shiftId, worker(1).id);
    expect(second.outcome).toBe("refused");
    expect(second.compliance_reasons).toContain("MISSING_CREDENTIAL");
  });

  it("readiness on explicit local dates: not before effective_from, exactly from it", async () => {
    const before = await must(
      admin.client.rpc("worker_readiness", {
        p_agency_worker_id: worker(1).id,
        p_agency_facility_id: river.facilityId,
        p_as_of: addDays(day, -1),
      }),
    );
    const on = await must(
      admin.client.rpc("worker_readiness", {
        p_agency_worker_id: worker(1).id,
        p_agency_facility_id: river.facilityId,
        p_as_of: day,
      }),
    );
    expect(before[0]?.readiness).toBe("ready");
    expect(on[0]?.readiness).not.toBe("ready");
  });

  it("the stored date is exactly the calendar date supplied, and there is no implicit default", async () => {
    const rows = await must(
      admin.client
        .from("credential_requirements")
        .select("effective_from, effective_until, status")
        .eq("agency_facility_id", river.facilityId)
        .order("created_at"),
    );
    expect(rows).toEqual([
      { effective_from: addDays(day, 1), effective_until: addDays(day, 1), status: "inactive" },
      { effective_from: day, effective_until: null, status: "active" },
    ]);
    const missing = await admin.client.rpc("create_credential_requirement", {
      p_agency_organisation_id: agencyId,
      p_credential_type_key: "tb_screening",
      // @ts-expect-error — the API requires an explicit date; null is refused server-side.
      p_effective_from: null,
    });
    expect(missing.error?.code).toBe("CH400");
  });

  it("another tenant cannot use this agency's facility (or its timezone)", async () => {
    const crossFacility = await otherAdmin.client.rpc("create_credential_requirement", {
      p_agency_organisation_id: otherAgencyId,
      p_credential_type_key: "facility_orientation",
      p_effective_from: day,
      p_agency_facility_id: river.facilityId,
    });
    expect(crossFacility.error?.code).toBe("CH403");
    const crossReadiness = await otherAdmin.client.rpc("worker_readiness", {
      p_agency_worker_id: worker(0).id,
      p_agency_facility_id: river.facilityId,
    });
    expect(crossReadiness.error?.code).toBe("CH403");
  });
});
