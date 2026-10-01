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
import {
  activateCna,
  assign,
  blsEvidence,
  createAgency,
  facilityWithRelationship,
  invite,
  must,
  run,
  workerIdAt,
  isoDay,
} from "./support/staffing";

/**
 * Time & attendance (P0-E6-S1) through the real API boundary: clocking with
 * server time, optional geofence with server-computed results, exceptions,
 * missed-clock detection, corrections that preserve history, the facility's
 * narrow projection and cross-tenant denial.
 */

const TZ = "America/New_York";
const SITE = { lat: 40.7128, lon: -74.006 };
/** Latitude offset (degrees) for a distance in metres on the mean-radius sphere. */
const metres = (m: number) => (m / 6371008.8) * (180 / Math.PI);

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

describe("time & attendance (P0-E6-S1)", () => {
  let admin: TestIdentity;
  let scheduler: TestIdentity;
  let betaAdmin: TestIdentity;
  let facilityAdmin: TestIdentity;
  const workers: Record<string, { identity: TestIdentity; id: string }> = {};
  let alphaId: string;
  let mercy: { facilityId: string; locationId: string; relationshipId: string };

  function w(name: string) {
    const worker = workers[name];
    if (!worker) throw new Error(`unknown worker ${name}`);
    return worker;
  }

  async function shiftFromNow(startMinutes: number, endMinutes: number, headcount = 4) {
    const start = local(new Date(Date.now() + startMinutes * 60_000));
    const end = local(new Date(Date.now() + endMinutes * 60_000));
    return must(
      scheduler.client.rpc("create_shift", {
        p_agency_facility_id: mercy.facilityId,
        p_facility_location_id: mercy.locationId,
        p_discipline_key: "cna",
        p_shift_date: start.date,
        p_start_time: start.time,
        p_end_time: end.time,
        p_requested_headcount: headcount,
        p_open: true,
      }),
    );
  }

  async function acceptedOn(shiftId: string, name: string): Promise<string> {
    const worker = workers[name];
    if (!worker) throw new Error(`unknown worker ${name}`);
    const decision = await assign(scheduler.client, shiftId, worker.id);
    await run(
      worker.identity.client.rpc("accept_shift_assignment", {
        p_assignment_id: decision.assignment_id ?? "",
      }),
    );
    return decision.assignment_id ?? "";
  }

  function clockIn(
    name: string,
    assignmentId: string,
    at?: { lat: number; lon: number; accuracy: number },
  ) {
    return w(name).identity.client.rpc("clock_in_assignment", {
      p_assignment_id: assignmentId,
      ...(at ? { p_latitude: at.lat, p_longitude: at.lon, p_accuracy_meters: at.accuracy } : {}),
    });
  }

  async function setGeofence(policy: "block" | "allow_with_review") {
    await run(
      admin.client.rpc("set_location_geofence", {
        p_facility_location_id: mercy.locationId,
        p_enabled: true,
        p_latitude: SITE.lat,
        p_longitude: SITE.lon,
        p_radius_meters: 200,
        p_max_accuracy_meters: 100,
        p_outside_policy: policy,
      }),
    );
  }

  beforeAll(async () => {
    [admin, betaAdmin] = await Promise.all([
      signUpVerified("att-alpha"),
      signUpVerified("att-beta"),
    ]);
    alphaId = await createAgency(admin, "Alpha Attendance Staffing");
    await createAgency(betaAdmin, "Beta Attendance Staffing");
    await Promise.all([stepUpToAal2(admin), stepUpToAal2(betaAdmin)]);
    scheduler = await invite(
      admin.client,
      alphaId,
      "agency.scheduler",
      uniqueEmail("att-scheduler"),
    );
    await run(
      admin.client.rpc("create_credential_requirement", {
        p_effective_from: isoDay(-30),
        p_agency_organisation_id: alphaId,
        p_credential_type_key: "bls_certification",
      }),
    );
    for (const name of ["wendy", "walt", "cara", "dan", "ed"]) {
      const identity = await invite(
        admin.client,
        alphaId,
        "agency.healthcare_worker",
        uniqueEmail(`att-${name}`),
      );
      const id = await workerIdAt(identity, alphaId);
      await activateCna(admin.client, id);
      await blsEvidence(identity, 400, [{ client: admin.client, organisationId: alphaId }]);
      workers[name] = { identity, id };
    }
    mercy = await facilityWithRelationship(admin.client, alphaId, "Mercy Rehab", TZ);

    const operator = await signUpVerified("att-operator");
    await grantPlatformAdmin(operator.userId);
    await stepUpToAal2(operator);
    const facilityEmail = uniqueEmail("att-facility");
    const created = await must(
      operator.client.rpc("platform_create_organisation", {
        p_type: "facility",
        p_name: "Mercy Health Attendance",
        p_slug: slug("mercy-att"),
        p_owner_email: facilityEmail,
      }),
    );
    facilityAdmin = await signUpVerified("att-facility", facilityEmail);
    await run(
      facilityAdmin.client.rpc("accept_organisation_invite", {
        p_token: created[0]?.invite_token ?? "",
      }),
    );
    await run(
      operator.client.rpc("platform_link_agency_facility", {
        p_agency_facility_id: mercy.facilityId,
        p_facility_organisation_id: created[0]?.organisation_id ?? "",
      }),
    );
    await setGeofence("allow_with_review");
  }, 240_000);

  let upcoming: string;
  let wendyAssignment: string;
  let caraAssignment: string;

  it("an accepted worker clocks in inside the window; the server records its own time", async () => {
    upcoming = await shiftFromNow(10, 240);
    wendyAssignment = await acceptedOn(upcoming, "wendy");
    const before = Date.now();
    const result = await must(
      clockIn("wendy", wendyAssignment, {
        lat: SITE.lat + metres(40),
        lon: SITE.lon,
        accuracy: 15,
      }),
    );
    expect(result[0]).toMatchObject({
      outcome: "recorded",
      geofence_result: "inside",
      exception_codes: [],
    });
    const recorded = new Date(result[0]?.recorded_at ?? 0).getTime();
    expect(Math.abs(recorded - before)).toBeLessThan(60_000);
  });

  it("a duplicate clock-in fails; clock-out succeeds; another worker sees nothing", async () => {
    const again = await clockIn("wendy", wendyAssignment, {
      lat: SITE.lat,
      lon: SITE.lon,
      accuracy: 15,
    });
    expect(again.error?.code).toBe("CHT09");
    const out = await must(
      w("wendy").identity.client.rpc("clock_out_assignment", {
        p_assignment_id: wendyAssignment,
        p_latitude: SITE.lat,
        p_longitude: SITE.lon,
        p_accuracy_meters: 10,
      }),
    );
    expect(out[0]?.outcome).toBe("recorded");
    const other = await w("walt")
      .identity.client.from("assignment_attendance")
      .select("id")
      .eq("assignment_id", wendyAssignment);
    expect(other.data).toEqual([]);
    const own = await w("wendy")
      .identity.client.from("assignment_attendance")
      .select("clock_state")
      .eq("assignment_id", wendyAssignment);
    expect(own.data).toEqual([{ clock_state: "clocked_out" }]);
  });

  it("outside the geofence follows the configured policy (review, then block)", async () => {
    caraAssignment = await acceptedOn(upcoming, "cara");
    const outside = { lat: SITE.lat + metres(900), lon: SITE.lon, accuracy: 15 };
    const reviewed = await must(clockIn("cara", caraAssignment, outside));
    expect(reviewed[0]).toMatchObject({
      outcome: "recorded",
      geofence_result: "outside",
      exception_codes: ["outside_geofence"],
    });

    await setGeofence("block");
    const danAssignment = await acceptedOn(upcoming, "dan");
    const blocked = await must(clockIn("dan", danAssignment, outside));
    expect(blocked[0]).toMatchObject({ outcome: "refused", refusal_code: "OUTSIDE_GEOFENCE" });
    const noLocation = await clockIn("dan", danAssignment);
    expect(noLocation.error?.code).toBe("CHT12");
    const inside = await must(
      clockIn("dan", danAssignment, { lat: SITE.lat, lon: SITE.lon, accuracy: 15 }),
    );
    expect(inside[0]?.outcome).toBe("recorded");
  });

  it("a late clock-in creates an exception reviewers can see", async () => {
    const started = await shiftFromNow(-20, 200, 1);
    const assignment = await acceptedOn(started, "walt");
    const result = await must(
      clockIn("walt", assignment, { lat: SITE.lat, lon: SITE.lon, accuracy: 15 }),
    );
    expect(result[0]?.exception_codes).toEqual(["late_clock_in"]);
    const rows = await must(
      admin.client.rpc("list_agency_attendance", { p_organisation_id: alphaId }),
    );
    const row = rows.find((item) => item.assignment_id === assignment);
    expect(row).toMatchObject({ needs_review: true, open_exception_types: ["late_clock_in"] });
  });

  it("the missed clock-in scan creates the exception exactly once", async () => {
    const started = await shiftFromNow(-40, 180, 1);
    const assignment = await acceptedOn(started, "ed");
    const scan = () =>
      ownerQuery(
        (sql) =>
          sql<
            { result: { missed_clock_in: number } }[]
          >`select internal.run_attendance_scan() as result`,
      );
    await scan();
    await scan();
    const exceptions = await must(
      admin.client
        .from("attendance_exceptions")
        .select("exception_type")
        .eq("assignment_id", assignment),
    );
    expect(exceptions).toEqual([{ exception_type: "missed_clock_in" }]);
  });

  it("a correction is reviewed; the summary reflects it while the original event remains", async () => {
    await run(
      w("cara").identity.client.rpc("clock_out_assignment", {
        p_assignment_id: caraAssignment,
        p_latitude: SITE.lat,
        p_longitude: SITE.lon,
        p_accuracy_meters: 10,
      }),
    );
    const [summaryBefore] = await must(
      admin.client
        .from("assignment_attendance")
        .select("clock_in_at")
        .eq("assignment_id", caraAssignment),
    );
    // A deterministic valid time: just after the recorded clock-in (and not in the future).
    const requested = new Date(
      new Date(summaryBefore?.clock_in_at ?? 0).getTime() + 1,
    ).toISOString();
    const correctionId = await must(
      w("cara").identity.client.rpc("request_attendance_correction", {
        p_assignment_id: caraAssignment,
        p_event_type: "clock_out",
        p_requested_time: requested,
        p_reason: "recorded_wrong_time",
      }),
    );
    const selfReview = await w("cara").identity.client.rpc("review_attendance_correction", {
      p_correction_id: correctionId,
      p_approve: true,
      p_resolution: "approved_as_requested",
    });
    expect(selfReview.error?.code).toBe("CHT04");
    await run(
      admin.client.rpc("review_attendance_correction", {
        p_correction_id: correctionId,
        p_approve: true,
        p_resolution: "approved_as_requested",
      }),
    );
    const events = await must(
      admin.client
        .from("attendance_events")
        .select("event_type")
        .eq("assignment_id", caraAssignment)
        .order("sequence"),
    );
    expect(events.map((event) => event.event_type)).toEqual([
      "clock_in",
      "clock_out",
      "corrected_clock_out",
    ]);
    const [summary] = await must(
      admin.client
        .from("assignment_attendance")
        .select("clock_state, clock_out_at")
        .eq("assignment_id", caraAssignment),
    );
    expect(summary?.clock_state).toBe("clocked_out");
    expect(new Date(summary?.clock_out_at ?? 0).toISOString()).toBe(requested);
  });

  it("the facility sees a narrow projection with location results but no coordinates", async () => {
    const rows = await must(
      facilityAdmin.client.rpc("list_facility_shift_attendance", { p_shift_id: upcoming }),
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toMatch(/latitude|longitude|accuracy|distance/);
    expect(rows.map((row) => row.clock_in_location)).toContain("inside");
    const evidence = await facilityAdmin.client.from("attendance_location_evidence").select("id");
    expect(evidence.data).toEqual([]);
    const schedulerEvidence = await scheduler.client
      .from("attendance_location_evidence")
      .select("id");
    expect(schedulerEvidence.data).toEqual([]);
  });

  it("another agency cannot read attendance", async () => {
    const listed = await betaAdmin.client.rpc("list_agency_attendance", {
      p_organisation_id: alphaId,
    });
    expect(listed.error?.code).toBe("CH403");
    const rows = await betaAdmin.client.from("assignment_attendance").select("id");
    expect(rows.data).toEqual([]);
    const corrections = await betaAdmin.client.from("attendance_corrections").select("id");
    expect(corrections.data).toEqual([]);
  });
});
