import { beforeAll, describe, expect, it } from "vitest";

import { uniqueEmail } from "../support/mailpit";
import {
  grantPlatformAdmin,
  signUpVerified,
  slug,
  stepUpToAal2,
  type TestIdentity,
} from "./support/identities";
import {
  addDays,
  closedPeriodStart,
  localInstant,
  pastEvidence,
  pastWork,
  runEvidencePurge,
} from "./support/past-work";
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
} from "./support/staffing";

/**
 * Timesheets & attendance review hardening (P0-E6-S2) through the real API:
 * derivation from attendance (breaks included), submission, agency approval,
 * per-facility sign-off across two linked facilities, revisions after a
 * post-lock correction, raw evidence authorization, retention purge, legal
 * hold and the refused clock-in rate limit.
 */

const TZ = "America/New_York";
const SITE = { lat: 40.7128, lon: -74.006 };

describe("timesheets (P0-E6-S2)", () => {
  let admin: TestIdentity;
  let scheduler: TestIdentity;
  let betaAdmin: TestIdentity;
  let gammaAdmin: TestIdentity;
  let deltaAdmin: TestIdentity;
  let alphaId: string;
  let gammaId: string;
  let deltaId: string;
  let mercy: { facilityId: string; locationId: string; relationshipId: string };
  let river: { facilityId: string; locationId: string; relationshipId: string };
  const workers: Record<string, { identity: TestIdentity; id: string }> = {};
  const ps = closedPeriodStart();

  function w(name: string) {
    const worker = workers[name];
    if (!worker) throw new Error(`unknown worker ${name}`);
    return worker;
  }

  function at(dayOffset: number, time: string) {
    return localInstant(addDays(ps, dayOffset), time, TZ);
  }

  function work(
    name: string,
    site: { facilityId: string; locationId: string },
    start: string,
    end: string,
    events: Parameters<typeof pastWork>[0]["events"],
  ) {
    return pastWork({
      scheduler,
      organisationId: alphaId,
      facilityId: site.facilityId,
      locationId: site.locationId,
      workerId: w(name).id,
      workerProfileId: w(name).identity.userId,
      startAt: start,
      endAt: end,
      events,
    });
  }

  async function timesheetOf(
    assignmentId: string,
  ): Promise<{ id: string; status: string; revision: number }> {
    const [entry] = await must(
      admin.client
        .from("timesheet_entries")
        .select("timesheet_id")
        .eq("assignment_id", assignmentId),
    );
    const [sheet] = await must(
      admin.client
        .from("timesheets")
        .select("id, status, revision")
        .eq("id", entry?.timesheet_id ?? ""),
    );
    if (!sheet) throw new Error("no timesheet");
    return sheet;
  }

  beforeAll(async () => {
    [admin, betaAdmin] = await Promise.all([signUpVerified("ts-alpha"), signUpVerified("ts-beta")]);
    alphaId = await createAgency(admin, "Alpha Timesheet Staffing");
    await createAgency(betaAdmin, "Beta Timesheet Staffing");
    await Promise.all([stepUpToAal2(admin), stepUpToAal2(betaAdmin)]);
    scheduler = await invite(
      admin.client,
      alphaId,
      "agency.scheduler",
      uniqueEmail("ts-scheduler"),
    );
    await run(
      admin.client.rpc("create_credential_requirement", {
        p_agency_organisation_id: alphaId,
        p_credential_type_key: "bls_certification",
      }),
    );
    for (const name of ["wendy", "walt", "ed"]) {
      const identity = await invite(
        admin.client,
        alphaId,
        "agency.healthcare_worker",
        uniqueEmail(`ts-${name}`),
      );
      const id = await workerIdAt(identity, alphaId);
      await activateCna(admin.client, id);
      await blsEvidence(identity, 400, [{ client: admin.client, organisationId: alphaId }]);
      workers[name] = { identity, id };
    }
    mercy = await facilityWithRelationship(admin.client, alphaId, "Mercy Rehab", TZ);
    river = await facilityWithRelationship(admin.client, alphaId, "Riverside", TZ);

    const operator = await signUpVerified("ts-operator");
    await grantPlatformAdmin(operator.userId);
    await stepUpToAal2(operator);
    async function facilityOrg(name: string, site: { facilityId: string }) {
      const email = uniqueEmail(`ts-${name}`);
      const created = await must(
        operator.client.rpc("platform_create_organisation", {
          p_type: "facility",
          p_name: `${name} Health`,
          p_slug: slug(name),
          p_owner_email: email,
        }),
      );
      const owner = await signUpVerified(`ts-${name}`, email);
      await run(
        owner.client.rpc("accept_organisation_invite", { p_token: created[0]?.invite_token ?? "" }),
      );
      await run(
        operator.client.rpc("platform_link_agency_facility", {
          p_agency_facility_id: site.facilityId,
          p_facility_organisation_id: created[0]?.organisation_id ?? "",
        }),
      );
      return { owner, id: created[0]?.organisation_id ?? "" };
    }
    ({ owner: gammaAdmin, id: gammaId } = await facilityOrg("gamma", mercy));
    ({ owner: deltaAdmin, id: deltaId } = await facilityOrg("delta", river));
  }, 240_000);

  let m1: string;
  let r1: string;
  let wendySheet: string;

  it("a completed shift derives its entry from attendance; breaks reduce worked time", async () => {
    m1 = (
      await work("wendy", mercy, at(1, "09:00"), at(1, "17:00"), [
        { type: "clock_in", at: at(1, "09:00") },
        { type: "break_start", at: at(1, "12:00") },
        { type: "break_end", at: at(1, "12:30") },
        { type: "clock_out", at: at(1, "17:00") },
      ])
    ).assignmentId;
    r1 = (
      await work("wendy", river, at(2, "08:00"), at(2, "12:00"), [
        { type: "clock_in", at: at(2, "08:00") },
        { type: "clock_out", at: at(2, "12:00") },
      ])
    ).assignmentId;
    wendySheet = (await timesheetOf(m1)).id;
    const entries = await must(
      w("wendy").identity.client.rpc("list_timesheet_entries", { p_timesheet_id: wendySheet }),
    );
    const mercyEntry = entries.find((entry) => entry.assignment_id === m1);
    expect(mercyEntry).toMatchObject({ worked_minutes: 450, break_minutes: 30, complete: true });
    expect(entries.find((entry) => entry.assignment_id === r1)?.worked_minutes).toBe(240);
    const sheet = await must(
      w("wendy").identity.client.rpc("get_timesheet", { p_timesheet_id: wendySheet }),
    );
    expect(sheet[0]).toMatchObject({ total_worked_minutes: 690, period_start: ps });
  });

  it("the worker submits; the agency approves; nobody can write minutes", async () => {
    const edit = await w("wendy")
      .identity.client.from("timesheet_entries")
      .update({ worked_minutes: 999 })
      .eq("assignment_id", m1)
      .select("id");
    expect(edit.error?.code).toBe("42501");
    const submitted = await must(
      w("wendy").identity.client.rpc("submit_timesheet", { p_timesheet_id: wendySheet }),
    );
    expect(submitted[0]).toMatchObject({ outcome: "submitted", blocking_reasons: [] });
    const selfApprove = await w("wendy").identity.client.rpc("approve_timesheet", {
      p_timesheet_id: wendySheet,
      p_expected_revision: 1,
    });
    expect(selfApprove.error?.code).toBe("CHP04");
    const schedulerApprove = await scheduler.client.rpc("approve_timesheet", {
      p_timesheet_id: wendySheet,
      p_expected_revision: 1,
    });
    expect(schedulerApprove.error?.code).toBe("CH403");
    const approved = await must(
      admin.client.rpc("approve_timesheet", { p_timesheet_id: wendySheet, p_expected_revision: 1 }),
    );
    expect(approved[0]?.outcome).toBe("agency_approved");
  });

  it("each facility sees and signs off only its own entry (multi-facility)", async () => {
    const gammaEntries = await must(
      gammaAdmin.client.rpc("list_facility_timesheet_entries", {
        p_facility_organisation_id: gammaId,
      }),
    );
    expect(gammaEntries.map((entry) => entry.facility_name)).toEqual(["Mercy Rehab"]);
    expect(JSON.stringify(gammaEntries)).not.toMatch(/latitude|longitude|note/);
    const deltaEntries = await must(
      deltaAdmin.client.rpc("list_facility_timesheet_entries", {
        p_facility_organisation_id: deltaId,
      }),
    );
    expect(deltaEntries.map((entry) => entry.facility_name)).toEqual(["Riverside"]);
    const mercyEntry = gammaEntries[0]?.entry_id ?? "";
    const riverEntry = deltaEntries[0]?.entry_id ?? "";

    const crossSign = await gammaAdmin.client.rpc("facility_decide_timesheet_entry", {
      p_entry_id: riverEntry,
      p_expected_revision: 1,
      p_sign_off: true,
    });
    expect(crossSign.error?.code).toBe("CHP12");
    const crossList = await gammaAdmin.client.rpc("list_facility_timesheet_entries", {
      p_facility_organisation_id: deltaId,
    });
    expect(crossList.error?.code).toBe("CH403");

    expect(
      await must(
        gammaAdmin.client.rpc("facility_decide_timesheet_entry", {
          p_entry_id: mercyEntry,
          p_expected_revision: 1,
          p_sign_off: true,
        }),
      ),
    ).toBe("agency_approved");
    expect(
      await must(
        deltaAdmin.client.rpc("facility_decide_timesheet_entry", {
          p_entry_id: riverEntry,
          p_expected_revision: 1,
          p_sign_off: true,
        }),
      ),
    ).toBe("locked");
  });

  it("a facility or agency outside the relationship cannot reach the timesheet", async () => {
    const tables = await gammaAdmin.client.from("timesheet_entries").select("id");
    expect(tables.data).toEqual([]);
    const beta = await betaAdmin.client.rpc("get_timesheet", { p_timesheet_id: wendySheet });
    expect(beta.error?.code).toBe("CHP04");
    const betaRows = await betaAdmin.client.from("timesheets").select("id");
    expect(betaRows.data).toEqual([]);
  });

  it("a correction to a locked entry needs an explicit revision and re-approval", async () => {
    const correctionId = await must(
      w("wendy").identity.client.rpc("request_attendance_correction", {
        p_assignment_id: m1,
        p_event_type: "clock_out",
        p_requested_time: at(1, "17:30"),
        p_reason: "recorded_wrong_time",
      }),
    );
    const unconfirmed = await admin.client.rpc("review_attendance_correction", {
      p_correction_id: correctionId,
      p_approve: true,
      p_resolution: "approved_as_requested",
    });
    expect(unconfirmed.error?.code).toBe("CHT22");
    await run(
      admin.client.rpc("review_attendance_correction", {
        p_correction_id: correctionId,
        p_approve: true,
        p_resolution: "approved_as_requested",
        p_confirm_revision: true,
      }),
    );
    expect(await timesheetOf(m1)).toMatchObject({ status: "submitted", revision: 2 });
    const approvals = await must(
      admin.client
        .from("timesheet_approvals")
        .select("revision, superseded_at")
        .eq("timesheet_id", wendySheet),
    );
    expect(approvals).toEqual([{ revision: 1, superseded_at: expect.any(String) }]);
    const [entry] = await must(
      admin.client.from("timesheet_entries").select("worked_minutes").eq("assignment_id", m1),
    );
    expect(entry?.worked_minutes).toBe(480);
    const events = await must(
      admin.client
        .from("attendance_events")
        .select("event_type")
        .eq("assignment_id", m1)
        .order("sequence"),
    );
    expect(events.map((event) => event.event_type)).toContain("clock_out");
  });

  it("a worker correction completes an open timesheet, which can then be submitted", async () => {
    const { assignmentId } = await work("walt", mercy, at(3, "09:00"), at(3, "13:00"), [
      { type: "clock_in", at: at(3, "09:00") },
    ]);
    const sheet = (await timesheetOf(assignmentId)).id;
    const blocked = await must(
      w("walt").identity.client.rpc("submit_timesheet", { p_timesheet_id: sheet }),
    );
    expect(blocked[0]).toMatchObject({
      outcome: "blocked",
      blocking_reasons: ["MISSING_CLOCK_OUT"],
    });
    const correctionId = await must(
      w("walt").identity.client.rpc("request_attendance_correction", {
        p_assignment_id: assignmentId,
        p_event_type: "clock_out",
        p_requested_time: at(3, "13:10"),
        p_reason: "forgot_to_clock",
      }),
    );
    await run(
      admin.client.rpc("review_attendance_correction", {
        p_correction_id: correctionId,
        p_approve: true,
        p_resolution: "approved_with_adjustment",
        p_approved_time: at(3, "13:00"),
        p_adjustment_reason: "supervisor_observation",
      }),
    );
    const entries = await must(
      w("walt").identity.client.rpc("list_timesheet_entries", { p_timesheet_id: sheet }),
    );
    expect(entries[0]?.worked_minutes).toBe(240);
    const submitted = await must(
      w("walt").identity.client.rpc("submit_timesheet", { p_timesheet_id: sheet }),
    );
    expect(submitted[0]?.outcome).toBe("submitted");
  });

  it("raw evidence needs attendance.location.view; purge keeps the result; a legal hold stops it", async () => {
    const old = new Date(Date.now() - 100 * 86_400_000);
    const oldDay = old.toISOString().slice(0, 10);
    const purged = await work(
      "ed",
      mercy,
      localInstant(oldDay, "09:00", TZ),
      localInstant(oldDay, "17:00", TZ),
      [],
    );
    const held = await work(
      "walt",
      mercy,
      localInstant(oldDay, "09:00", TZ),
      localInstant(oldDay, "17:00", TZ),
      [],
    );
    const purgedAttendance = await pastEvidence(
      purged.assignmentId,
      localInstant(oldDay, "09:00", TZ),
    );
    const heldAttendance = await pastEvidence(held.assignmentId, localInstant(oldDay, "09:00", TZ));

    const denied = await scheduler.client.rpc("list_attendance_location_evidence", {
      p_attendance_id: purgedAttendance,
    });
    expect(denied.error?.code).toBe("CH403");
    const facilityDenied = await gammaAdmin.client.rpc("list_attendance_location_evidence", {
      p_attendance_id: purgedAttendance,
    });
    expect(facilityDenied.error?.code).toBe("CHT04");
    const before = await must(
      admin.client.rpc("list_attendance_location_evidence", { p_attendance_id: purgedAttendance }),
    );
    expect(before[0]).toMatchObject({ state: "retained", latitude: 40.7128 });

    await run(
      admin.client.rpc("place_location_evidence_hold", {
        p_attendance_id: heldAttendance,
        p_reason: "Grievance review",
      }),
    );
    await runEvidencePurge();

    const after = await must(
      admin.client.rpc("list_attendance_location_evidence", { p_attendance_id: purgedAttendance }),
    );
    expect(after[0]).toMatchObject({ state: "purged", latitude: null, result: "inside" });
    const [event] = await must(
      admin.client
        .from("attendance_events")
        .select("geofence_result")
        .eq("attendance_id", purgedAttendance),
    );
    expect(event?.geofence_result).toBe("inside");
    const kept = await must(
      admin.client.rpc("list_attendance_location_evidence", { p_attendance_id: heldAttendance }),
    );
    expect(kept[0]).toMatchObject({ state: "on_hold", latitude: 40.7128 });
  });

  it("repeated refused clock-ins are rate limited without unbounded records", async () => {
    await run(
      admin.client.rpc("set_location_geofence", {
        p_facility_location_id: river.locationId,
        p_enabled: true,
        p_latitude: SITE.lat,
        p_longitude: SITE.lon,
        p_radius_meters: 200,
        p_max_accuracy_meters: 100,
        p_outside_policy: "block",
      }),
    );
    const start = new Date(Date.now() + 10 * 60_000);
    const end = new Date(Date.now() + 120 * 60_000);
    const fmt = (instant: Date) => {
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
    };
    const shiftId = await must(
      scheduler.client.rpc("create_shift", {
        p_agency_facility_id: river.facilityId,
        p_facility_location_id: river.locationId,
        p_discipline_key: "cna",
        p_shift_date: fmt(start).date,
        p_start_time: fmt(start).time,
        p_end_time: fmt(end).time,
        p_requested_headcount: 1,
        p_open: true,
      }),
    );
    const decision = await assign(scheduler.client, shiftId, w("ed").id);
    await run(
      w("ed").identity.client.rpc("accept_shift_assignment", {
        p_assignment_id: decision.assignment_id ?? "",
      }),
    );
    const outside = {
      p_assignment_id: decision.assignment_id ?? "",
      p_latitude: SITE.lat + 0.01,
      p_longitude: SITE.lon,
      p_accuracy_meters: 10,
    };
    const outcomes: string[] = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await must(w("ed").identity.client.rpc("clock_in_assignment", outside));
      outcomes.push(result[0]?.outcome ?? "");
    }
    expect(new Set(outcomes)).toEqual(new Set(["refused"]));
    const limited = await w("ed").identity.client.rpc("clock_in_assignment", outside);
    expect(limited.error?.code).toBe("CH429");
    const exceptions = await must(
      admin.client
        .from("attendance_exceptions")
        .select("exception_type")
        .eq("assignment_id", decision.assignment_id ?? ""),
    );
    expect(exceptions).toEqual([{ exception_type: "outside_geofence" }]);
  });
});
