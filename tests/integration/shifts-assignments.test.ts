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
 * Shift requests & assignments (P0-E5-S1) through the real API boundary:
 * compliance gate on the shift date, worker acceptance, facility requests and
 * projections, capacity under CONCURRENCY, and the cross-agency conflict.
 */

describe("shift requests & assignments (P0-E5-S1)", () => {
  let alphaAdmin: TestIdentity;
  let scheduler: TestIdentity;
  let betaAdmin: TestIdentity;
  let facilityAdmin: TestIdentity;
  let wendy: TestIdentity; // works for Alpha AND Beta
  let walt: TestIdentity; // BLS expires in 12 days
  let cara: TestIdentity; // ready
  let nina: TestIdentity; // no credentials
  let alphaId: string;
  let betaId: string;
  let gammaId: string;
  const w: Record<string, string> = {};
  let mercy: { facilityId: string; locationId: string; relationshipId: string };
  let betaClient: { facilityId: string; locationId: string; relationshipId: string };

  function createShift(
    client: TestClient,
    site: { facilityId: string; locationId: string },
    day: number,
    start: string,
    end: string,
    headcount = 1,
  ) {
    return must(
      client.rpc("create_shift", {
        p_agency_facility_id: site.facilityId,
        p_facility_location_id: site.locationId,
        p_discipline_key: "cna",
        p_shift_date: isoDay(day),
        p_start_time: start,
        p_end_time: end,
        p_requested_headcount: headcount,
        p_open: true,
      }),
    );
  }

  beforeAll(async () => {
    [alphaAdmin, betaAdmin] = await Promise.all([
      signUpVerified("shift-alpha"),
      signUpVerified("shift-beta"),
    ]);
    [alphaId, betaId] = await Promise.all([
      createAgency(alphaAdmin, "Alpha Shift Staffing"),
      createAgency(betaAdmin, "Beta Shift Staffing"),
    ]);
    await Promise.all([stepUpToAal2(alphaAdmin), stepUpToAal2(betaAdmin)]);

    scheduler = await invite(
      alphaAdmin.client,
      alphaId,
      "agency.scheduler",
      uniqueEmail("scheduler"),
    );
    wendy = await invite(
      alphaAdmin.client,
      alphaId,
      "agency.healthcare_worker",
      uniqueEmail("wendy"),
    );
    await invite(betaAdmin.client, betaId, "agency.healthcare_worker", wendy);
    walt = await invite(
      alphaAdmin.client,
      alphaId,
      "agency.healthcare_worker",
      uniqueEmail("walt"),
    );
    cara = await invite(
      alphaAdmin.client,
      alphaId,
      "agency.healthcare_worker",
      uniqueEmail("cara"),
    );
    nina = await invite(
      alphaAdmin.client,
      alphaId,
      "agency.healthcare_worker",
      uniqueEmail("nina"),
    );

    w.wendy = await workerIdAt(wendy, alphaId);
    w.wendyBeta = await workerIdAt(wendy, betaId);
    w.walt = await workerIdAt(walt, alphaId);
    w.cara = await workerIdAt(cara, alphaId);
    w.nina = await workerIdAt(nina, alphaId);
    for (const id of [w.wendy, w.walt, w.cara, w.nina])
      await activateCna(alphaAdmin.client, id ?? "");
    await activateCna(betaAdmin.client, w.wendyBeta ?? "");

    for (const [client, organisationId] of [
      [alphaAdmin.client, alphaId],
      [betaAdmin.client, betaId],
    ] as const) {
      await run(
        client.rpc("create_credential_requirement", {
          p_agency_organisation_id: organisationId,
          p_credential_type_key: "bls_certification",
          p_expiry_warning_days: 7,
        }),
      );
    }
    const alphaVerifier = { client: alphaAdmin.client, organisationId: alphaId };
    await blsEvidence(wendy, 400, [
      alphaVerifier,
      { client: betaAdmin.client, organisationId: betaId },
    ]);
    await blsEvidence(walt, 12, [alphaVerifier]);
    await blsEvidence(cara, 400, [alphaVerifier]);

    mercy = await facilityWithRelationship(
      alphaAdmin.client,
      alphaId,
      "Mercy Rehab",
      "America/New_York",
    );
    betaClient = await facilityWithRelationship(
      betaAdmin.client,
      betaId,
      "Beta Clinic",
      "America/New_York",
    );

    // A real facility organisation, linked to Alpha's Mercy record by a platform operator.
    const operator = await signUpVerified("shift-operator");
    await grantPlatformAdmin(operator.userId);
    await stepUpToAal2(operator);
    const facilityOwnerEmail = uniqueEmail("gamma-admin");
    const facilityOrg = await must(
      operator.client.rpc("platform_create_organisation", {
        p_type: "facility",
        p_name: "Mercy Health Group",
        p_slug: slug("mercy-health"),
        p_owner_email: facilityOwnerEmail,
      }),
    );
    gammaId = facilityOrg[0]?.organisation_id ?? "";
    facilityAdmin = await signUpVerified("gamma-admin", facilityOwnerEmail);
    await run(
      facilityAdmin.client.rpc("accept_organisation_invite", {
        p_token: facilityOrg[0]?.invite_token ?? "",
      }),
    );
    await run(
      operator.client.rpc("platform_link_agency_facility", {
        p_agency_facility_id: mercy.facilityId,
        p_facility_organisation_id: gammaId,
      }),
    );
  }, 180_000);

  let dayShift: string;

  it("a scheduler creates an open shift; fill state is derived", async () => {
    dayShift = await createShift(scheduler.client, mercy, 3, "07:00", "15:00", 2);
    const shifts = await must(
      scheduler.client.rpc("list_agency_shifts", { p_organisation_id: alphaId }),
    );
    const row = shifts.find((shift) => shift.shift_id === dayShift);
    expect(row).toMatchObject({ status: "open", fill_state: "unfilled", requested_headcount: 2 });
  });

  it("a ready worker is assigned; the decision is recorded", async () => {
    const decision = await assign(scheduler.client, dayShift, w.wendy ?? "");
    expect(decision.outcome).toBe("allowed");
    const decisions = await must(
      scheduler.client
        .from("assignment_eligibility_decisions")
        .select("outcome, readiness")
        .eq("shift_id", dayShift),
    );
    expect(decisions).toEqual([{ outcome: "allowed", readiness: "ready" }]);
  });

  it("a non-compliant worker is refused with reasons", async () => {
    const decision = await assign(scheduler.client, dayShift, w.nina ?? "");
    expect(decision).toMatchObject({
      outcome: "refused",
      primary_reason: "WORKER_NOT_ELIGIBLE",
      assignment_id: null,
    });
    expect(decision.compliance_reasons).toEqual(["MISSING_CREDENTIAL"]);
  });

  it("a credential that expires before a future shift blocks that shift", async () => {
    const readinessToday = await must(
      scheduler.client.rpc("worker_readiness", { p_agency_worker_id: w.walt ?? "" }),
    );
    expect(readinessToday[0]?.readiness).toBe("ready");
    const later = await createShift(scheduler.client, mercy, 20, "07:00", "15:00");
    const decision = await assign(scheduler.client, later, w.walt ?? "");
    expect(decision).toMatchObject({ outcome: "refused", primary_reason: "WORKER_NOT_ELIGIBLE" });
    expect(decision.compliance_reasons).toEqual(["EXPIRED_CREDENTIAL"]);
  });

  it("the worker accepts their own assignment and cannot see anyone else's", async () => {
    const mine = await must(
      wendy.client.rpc("list_my_shift_assignments", { p_organisation_id: alphaId }),
    );
    expect(mine).toHaveLength(1);
    const accepted = await wendy.client.rpc("accept_shift_assignment", {
      p_assignment_id: mine[0]?.assignment_id ?? "",
    });
    expect(accepted.error).toBeNull();
    const byOther = await cara.client
      .from("shift_assignments")
      .select("id")
      .eq("shift_id", dayShift);
    expect(byOther.data).toEqual([]);
    const spoof = await cara.client.rpc("decline_shift_assignment", {
      p_assignment_id: mine[0]?.assignment_id ?? "",
    });
    expect(spoof.error?.code).toBe("CHA04");
  });

  it("the final slot cannot be overfilled under concurrency", async () => {
    // Two schedulers race for the one remaining slot with two different ready workers.
    const [first, second] = await Promise.all([
      assign(scheduler.client, dayShift, w.cara ?? ""),
      assign(alphaAdmin.client, dayShift, w.walt ?? ""),
    ]);
    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(["allowed", "refused"]);
    expect([first.primary_reason, second.primary_reason]).toContain("SHIFT_FULL");
    const active = await must(
      scheduler.client
        .from("shift_assignments")
        .select("id")
        .eq("shift_id", dayShift)
        .in("status", ["assigned", "accepted"]),
    );
    expect(active).toHaveLength(2);
  });

  it("concurrent duplicate assignments of the same worker produce one assignment", async () => {
    const shift = await createShift(scheduler.client, mercy, 5, "07:00", "15:00", 3);
    const results = await Promise.all([
      assign(scheduler.client, shift, w.cara ?? ""),
      assign(alphaAdmin.client, shift, w.cara ?? ""),
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["allowed", "refused"]);
    expect(results.map((result) => result.primary_reason)).toContain("ASSIGNMENT_ALREADY_EXISTS");
  });

  it("a worker declines their own assignment", async () => {
    const shift = await createShift(scheduler.client, mercy, 4, "07:00", "15:00");
    const decision = await assign(scheduler.client, shift, w.walt ?? "");
    expect(decision.outcome).toBe("allowed");
    const declined = await walt.client.rpc("decline_shift_assignment", {
      p_assignment_id: decision.assignment_id ?? "",
    });
    expect(declined.error).toBeNull();
    const again = await walt.client.rpc("accept_shift_assignment", {
      p_assignment_id: decision.assignment_id ?? "",
    });
    expect(again.error?.code).toBe("CHA09");
  });

  it("the same person cannot be double-booked through another agency, and Beta learns only a generic conflict", async () => {
    // Mercy 07:00–15:00 New York overlaps Beta 10:00–12:00 New York on the same day.
    const betaShift = await createShift(betaAdmin.client, betaClient, 3, "10:00", "12:00");
    const decision = await assign(betaAdmin.client, betaShift, w.wendyBeta ?? "");
    expect(decision).toMatchObject({
      outcome: "refused",
      primary_reason: "WORKER_SCHEDULE_CONFLICT",
    });
    const serialised = JSON.stringify(decision);
    expect(serialised).not.toContain(alphaId);
    expect(serialised).not.toContain(dayShift);
    expect(serialised).not.toContain("Mercy");
    const betaSees = await betaAdmin.client
      .from("shift_assignments")
      .select("id")
      .eq("agency_organisation_id", alphaId);
    expect(betaSees.data).toEqual([]);

    // Back-to-back is fine.
    const backToBack = await createShift(betaAdmin.client, betaClient, 3, "15:00", "19:00");
    expect((await assign(betaAdmin.client, backToBack, w.wendyBeta ?? "")).outcome).toBe("allowed");
  });

  let requestId: string;

  it("a facility submits a request through its relationship and the agency opens it", async () => {
    const options = await must(
      facilityAdmin.client.rpc("list_facility_request_options", {
        p_relationship_id: mercy.relationshipId,
      }),
    );
    requestId = await must(
      facilityAdmin.client.rpc("submit_facility_shift_request", {
        p_relationship_id: mercy.relationshipId,
        p_facility_location_id: options[0]?.facility_location_id ?? "",
        p_discipline_key: "cna",
        p_shift_date: isoDay(8),
        p_start_time: "19:00",
        p_end_time: "07:00",
        p_requested_headcount: 1,
        p_instructions: "Use the staff entrance",
      }),
    );
    const outside = await facilityAdmin.client.rpc("submit_facility_shift_request", {
      p_relationship_id: betaClient.relationshipId,
      p_facility_location_id: betaClient.locationId,
      p_discipline_key: "cna",
      p_shift_date: isoDay(8),
      p_start_time: "07:00",
      p_end_time: "15:00",
      p_requested_headcount: 1,
    });
    expect(outside.error?.code).toBe("CH403");

    await run(scheduler.client.rpc("open_shift", { p_shift_id: requestId }));
    expect((await assign(scheduler.client, requestId, w.cara ?? "")).outcome).toBe("allowed");
  });

  it("the facility sees only its relationship's shifts and a narrow worker projection", async () => {
    const shifts = await must(
      facilityAdmin.client.rpc("list_facility_shifts", { p_facility_organisation_id: gammaId }),
    );
    expect(shifts.every((shift) => shift.relationship_id === mercy.relationshipId)).toBe(true);
    const request = shifts.find((shift) => shift.shift_id === requestId);
    expect(request).toMatchObject({
      status: "open",
      source: "facility",
      fill_state: "filled",
      active_count: 1,
    });

    const workers = await must(
      facilityAdmin.client.rpc("list_facility_shift_assignments", { p_shift_id: requestId }),
    );
    expect(workers).toHaveLength(1);
    expect(Object.keys(workers[0] ?? {}).sort()).toEqual(
      ["assignment_id", "discipline_name", "readiness", "status", "worker_display_name"].sort(),
    );
    expect(workers[0]?.readiness).toBe("ready");

    const direct = await facilityAdmin.client.from("shifts").select("id");
    expect(direct.data).toEqual([]);
    const notes = await facilityAdmin.client.from("shift_internal_notes").select("id");
    expect(notes.data).toEqual([]);
  });

  it("cancelling a shift cancels its assignments and prevents further assignment", async () => {
    await run(
      scheduler.client.rpc("cancel_shift", {
        p_shift_id: requestId,
        p_reason: "staffing_no_longer_needed",
      }),
    );
    const assignments = await must(
      scheduler.client
        .from("shift_assignments")
        .select("status, cancellation_reason")
        .eq("shift_id", requestId),
    );
    expect(assignments).toEqual([{ status: "cancelled", cancellation_reason: "shift_cancelled" }]);
    const after = await scheduler.client.rpc("assign_worker_to_shift", {
      p_shift_id: requestId,
      p_agency_worker_id: w.walt ?? "",
    });
    expect(after.error?.code).toBe("CHS09");
  });

  it("another agency cannot read or act on Alpha's shifts", async () => {
    const read = await betaAdmin.client.from("shifts").select("id").eq("id", dayShift);
    expect(read.data).toEqual([]);
    const act = await betaAdmin.client.rpc("cancel_shift", {
      p_shift_id: dayShift,
      p_reason: "other",
    });
    expect(act.error?.code).toBe("CHS04");
  });
});
