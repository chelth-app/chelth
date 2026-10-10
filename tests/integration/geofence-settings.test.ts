import { beforeAll, describe, expect, it } from "vitest";

import { uniqueEmail } from "../support/mailpit";
import { ownerQuery, signUpVerified, stepUpToAal2, type TestIdentity } from "./support/identities";
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
 * Geofence settings + pilot readiness guard (P0-E9-3E.1) through the real API
 * boundary: agency policy and defaults (AAL2, capability, tenant), per-location
 * overrides, the require-geofencing guard at clock-in (CHT23, nothing
 * recorded), the optional mode and the readiness listing.
 */

const TZ = "America/Chicago";
const SITE = { lat: 41.8781, lon: -87.6298 };

function local(instant: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}

describe("geofence settings and readiness (P0-E9-3E.1)", () => {
  let admin: TestIdentity;
  let scheduler: TestIdentity;
  let betaAdmin: TestIdentity;
  let alphaId: string;
  let facility: { facilityId: string; locationId: string };
  let annexId: string;
  const workers: Record<string, { identity: TestIdentity; id: string }> = {};

  function w(name: string) {
    const worker = workers[name];
    if (!worker) throw new Error(`unknown worker ${name}`);
    return worker;
  }

  function policy(
    client: TestIdentity["client"],
    requireGeofence: boolean,
    radius = 150,
    accuracy = 100,
  ) {
    return client.rpc("set_geofence_policy", {
      p_organisation_id: alphaId,
      p_require_geofence: requireGeofence,
      p_default_radius_meters: radius,
      p_default_max_accuracy_meters: accuracy,
      p_default_outside_policy: "block",
    });
  }

  async function acceptedAt(locationId: string, name: string): Promise<string> {
    const worker = workers[name];
    if (!worker) throw new Error(`unknown worker ${name}`);
    const start = local(new Date(Date.now() + 10 * 60_000));
    const end = local(new Date(Date.now() + 240 * 60_000));
    const shiftId = await must(
      scheduler.client.rpc("create_shift", {
        p_agency_facility_id: facility.facilityId,
        p_facility_location_id: locationId,
        p_discipline_key: "cna",
        p_shift_date: start.date,
        p_start_time: start.time,
        p_end_time: end.time,
        p_requested_headcount: 2,
        p_open: true,
      }),
    );
    const decision = await assign(scheduler.client, shiftId, worker.id);
    await run(
      worker.identity.client.rpc("accept_shift_assignment", {
        p_assignment_id: decision.assignment_id ?? "",
      }),
    );
    return decision.assignment_id ?? "";
  }

  beforeAll(async () => {
    [admin, betaAdmin] = await Promise.all([
      signUpVerified("geo-alpha"),
      signUpVerified("geo-beta"),
    ]);
    alphaId = await createAgency(admin, "Alpha Geofence Staffing");
    await createAgency(betaAdmin, "Beta Geofence Staffing");
    await Promise.all([stepUpToAal2(admin), stepUpToAal2(betaAdmin)]);
    scheduler = await invite(admin.client, alphaId, "agency.scheduler", uniqueEmail("geo-sched"));
    await run(
      admin.client.rpc("create_credential_requirement", {
        p_effective_from: isoDay(-30),
        p_agency_organisation_id: alphaId,
        p_credential_type_key: "bls_certification",
      }),
    );
    for (const name of ["gia", "hal", "ivy"]) {
      const identity = await invite(
        admin.client,
        alphaId,
        "agency.healthcare_worker",
        uniqueEmail(`geo-${name}`),
      );
      const id = await workerIdAt(identity, alphaId);
      await activateCna(admin.client, id);
      await blsEvidence(identity, 400, [{ client: admin.client, organisationId: alphaId }]);
      workers[name] = { identity, id };
    }
    facility = await facilityWithRelationship(admin.client, alphaId, "Riverside Medical", TZ);
    annexId = await must(
      admin.client.rpc("create_facility_location", {
        p_facility_id: facility.facilityId,
        p_name: "West Clinic",
      }),
    );
  }, 240_000);

  it("defaults load for a new agency and save with audit (AAL2)", async () => {
    const before = await must(
      admin.client
        .from("agency_attendance_settings")
        .select("*")
        .eq("agency_organisation_id", alphaId),
    );
    expect(before).toEqual([]);

    await run(policy(admin.client, false, 120, 80));
    const saved = await must(
      admin.client
        .from("agency_attendance_settings")
        .select(
          "require_geofence, default_geofence_radius_meters, default_geofence_max_accuracy_meters, default_geofence_outside_policy",
        )
        .eq("agency_organisation_id", alphaId),
    );
    expect(saved).toEqual([
      {
        require_geofence: false,
        default_geofence_radius_meters: 120,
        default_geofence_max_accuracy_meters: 80,
        default_geofence_outside_policy: "block",
      },
    ]);
    const audit = await ownerQuery(
      (sql) =>
        sql<
          { count: string }[]
        >`select count(*) from public.audit_events where organisation_id = ${alphaId} and action = 'attendance.geofence_policy_updated'`,
    );
    expect(Number(audit[0]?.count)).toBe(1);
  });

  it("rejects out-of-range values, other roles and other agencies", async () => {
    expect((await policy(admin.client, false, 49)).error?.code).toBe("CH400");
    expect((await policy(admin.client, false, 2001)).error?.code).toBe("CH400");
    expect((await policy(admin.client, false, 150, 9)).error?.code).toBe("CH400");
    expect((await policy(admin.client, false, 150, 501)).error?.code).toBe("CH400");
    expect((await policy(scheduler.client, true)).error?.code).toBe("CH403");
    expect((await policy(betaAdmin.client, true)).error?.code).toBe("CH403");
    expect((await policy(w("gia").identity.client, true)).error?.code).toBe("CH403");
  });

  it("locations override the defaults independently; defaults never rewrite them", async () => {
    await run(policy(admin.client, false, 150, 100));
    await run(
      admin.client.rpc("set_location_geofence", {
        p_facility_location_id: facility.locationId,
        p_enabled: true,
        p_latitude: SITE.lat,
        p_longitude: SITE.lon,
        p_radius_meters: 250,
        p_max_accuracy_meters: 60,
        p_outside_policy: "block",
      }),
    );
    await run(policy(admin.client, false, 75, 30));
    const rows = await must(
      admin.client.rpc("list_geofence_readiness", { p_organisation_id: alphaId }),
    );
    const main = rows.find((row) => row.location_id === facility.locationId);
    const annex = rows.find((row) => row.location_id === annexId);
    expect(main).toMatchObject({ readiness: "ready", radius_meters: 250, max_accuracy_meters: 60 });
    expect(annex).toMatchObject({ readiness: "not_configured", radius_meters: null });
    expect(JSON.stringify(rows)).not.toMatch(/latitude|longitude|41\.87/);
    const denied = await betaAdmin.client.rpc("list_geofence_readiness", {
      p_organisation_id: alphaId,
    });
    expect(denied.error?.code).toBe("CH403");
  });

  it("when geofencing is required, an unconfigured location refuses check-in and records nothing", async () => {
    await run(policy(admin.client, true));
    const assignmentId = await acceptedAt(annexId, "gia");
    const refused = await w("gia").identity.client.rpc("clock_in_assignment", {
      p_assignment_id: assignmentId,
    });
    expect(refused.error?.code).toBe("CHT23");
    const events = await ownerQuery(
      (sql) =>
        sql<
          { count: string }[]
        >`select count(*) from public.attendance_events where assignment_id = ${assignmentId}`,
    );
    expect(Number(events[0]?.count)).toBe(0);

    // The configured location evaluates normally.
    const insideId = await acceptedAt(facility.locationId, "hal");
    const inside = await must(
      w("hal").identity.client.rpc("clock_in_assignment", {
        p_assignment_id: insideId,
        p_latitude: SITE.lat,
        p_longitude: SITE.lon,
        p_accuracy_meters: 15,
        p_device_captured_at: new Date().toISOString(),
      }),
    );
    expect(inside[0]).toMatchObject({ outcome: "recorded", geofence_result: "inside" });
  });

  it("when geofencing is optional, an unconfigured location keeps the documented not_required behaviour", async () => {
    await run(policy(admin.client, false));
    const assignmentId = await acceptedAt(annexId, "ivy");
    const recorded = await must(
      w("ivy").identity.client.rpc("clock_in_assignment", { p_assignment_id: assignmentId }),
    );
    expect(recorded[0]).toMatchObject({ outcome: "recorded", geofence_result: "not_required" });
  });
});
