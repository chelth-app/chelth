import { beforeAll, describe, expect, it } from "vitest";

import { uniqueEmail } from "../support/mailpit";
import {
  grantPlatformAdmin,
  signUpVerified,
  slug,
  stepUpToAal2,
  type TestIdentity,
} from "./support/identities";
import { addDays, closedPeriodStart, localInstant, pastWork } from "./support/past-work";
import {
  activateCna,
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
 * Pay & bill rate foundations (P0-E7-S1) through the real API: versioned rates,
 * pricing of locked timesheet revisions with exact integer arithmetic,
 * immutability against later rate changes, revisions, fail-closed missing
 * rates, tenant/facility/worker isolation and the S7 relationship-end fix.
 */

const CHICAGO = "America/Chicago";
const NEW_YORK = "America/New_York";

describe("pay & bill rates and pricing (P0-E7-S1)", () => {
  let admin: TestIdentity;
  let finance: TestIdentity;
  let scheduler: TestIdentity;
  let betaAdmin: TestIdentity;
  let gammaAdmin: TestIdentity;
  let alphaId: string;
  let gammaId: string;
  let river: { facilityId: string; locationId: string; relationshipId: string };
  let mercy: { facilityId: string; locationId: string; relationshipId: string };
  const workers: Record<string, { identity: TestIdentity; id: string }> = {};
  const ps = closedPeriodStart();

  function w(name: string) {
    const worker = workers[name];
    if (!worker) throw new Error(`unknown worker ${name}`);
    return worker;
  }

  async function lockedTimesheet(
    name: string,
    site: { facilityId: string; locationId: string },
    timezone: string,
    shifts: { day: number; start: string; end: string; out?: string }[],
  ): Promise<string> {
    let assignmentId = "";
    for (const shift of shifts) {
      const date = addDays(ps, shift.day);
      assignmentId = (
        await pastWork({
          scheduler,
          organisationId: alphaId,
          facilityId: site.facilityId,
          locationId: site.locationId,
          workerId: w(name).id,
          workerProfileId: w(name).identity.userId,
          startAt: localInstant(date, shift.start, timezone),
          endAt: localInstant(date, shift.end, timezone),
          events: [
            { type: "clock_in", at: localInstant(date, shift.start, timezone) },
            { type: "clock_out", at: localInstant(date, shift.out ?? shift.end, timezone) },
          ],
        })
      ).assignmentId;
    }
    const [entry] = await must(
      admin.client
        .from("timesheet_entries")
        .select("timesheet_id")
        .eq("assignment_id", assignmentId),
    );
    const timesheetId = entry?.timesheet_id ?? "";
    const [sheet] = await must(
      admin.client.from("timesheets").select("revision").eq("id", timesheetId),
    );
    const revision = sheet?.revision ?? 1;
    await run(w(name).identity.client.rpc("submit_timesheet", { p_timesheet_id: timesheetId }));
    await run(
      admin.client.rpc("approve_timesheet", {
        p_timesheet_id: timesheetId,
        p_expected_revision: revision,
      }),
    );
    return timesheetId;
  }

  async function activeRate(
    relationshipId: string | null,
    pay: number,
    bill: number,
    from: string,
  ): Promise<{ cardId: string; versionId: string }> {
    const cardId = await must(
      finance.client.rpc("create_rate_card", {
        p_organisation_id: alphaId,
        p_discipline_key: "cna",
        ...(relationshipId ? { p_relationship_id: relationshipId } : {}),
      }),
    );
    const versionId = await must(
      finance.client.rpc("create_rate_version", {
        p_rate_card_id: cardId,
        p_currency: "USD",
        p_pay_rate_minor: pay,
        p_bill_rate_minor: bill,
        p_effective_from: from,
      }),
    );
    await run(finance.client.rpc("activate_rate_version", { p_version_id: versionId }));
    return { cardId, versionId };
  }

  beforeAll(async () => {
    [admin, betaAdmin] = await Promise.all([signUpVerified("pr-alpha"), signUpVerified("pr-beta")]);
    alphaId = await createAgency(admin, "Alpha Pricing Staffing");
    await createAgency(betaAdmin, "Beta Pricing Staffing");
    await Promise.all([stepUpToAal2(admin), stepUpToAal2(betaAdmin)]);
    scheduler = await invite(
      admin.client,
      alphaId,
      "agency.scheduler",
      uniqueEmail("pr-scheduler"),
    );
    finance = await invite(admin.client, alphaId, "agency.finance", uniqueEmail("pr-finance"));
    await stepUpToAal2(finance);
    await run(
      admin.client.rpc("create_credential_requirement", {
        p_effective_from: isoDay(-30),
        p_agency_organisation_id: alphaId,
        p_credential_type_key: "bls_certification",
      }),
    );
    for (const name of ["wendy", "walt", "ed"]) {
      const identity = await invite(
        admin.client,
        alphaId,
        "agency.healthcare_worker",
        uniqueEmail(`pr-${name}`),
      );
      const id = await workerIdAt(identity, alphaId);
      await activateCna(admin.client, id);
      await blsEvidence(identity, 400, [{ client: admin.client, organisationId: alphaId }]);
      workers[name] = { identity, id };
    }
    river = await facilityWithRelationship(admin.client, alphaId, "Riverside", CHICAGO);
    mercy = await facilityWithRelationship(admin.client, alphaId, "Mercy Rehab", NEW_YORK);

    const operator = await signUpVerified("pr-operator");
    await grantPlatformAdmin(operator.userId);
    await stepUpToAal2(operator);
    const email = uniqueEmail("pr-gamma");
    const created = await must(
      operator.client.rpc("platform_create_organisation", {
        p_type: "facility",
        p_name: "Gamma Health Pricing",
        p_slug: slug("gamma-pr"),
        p_owner_email: email,
      }),
    );
    gammaId = created[0]?.organisation_id ?? "";
    gammaAdmin = await signUpVerified("pr-gamma", email);
    await run(
      gammaAdmin.client.rpc("accept_organisation_invite", {
        p_token: created[0]?.invite_token ?? "",
      }),
    );
    await run(
      operator.client.rpc("platform_link_agency_facility", {
        p_agency_facility_id: mercy.facilityId,
        p_facility_organisation_id: gammaId,
      }),
    );
  }, 240_000);

  let wendySheet: string;
  let firstPricing: string;
  let riverRate: { cardId: string; versionId: string };

  it("a finance user creates and activates a rate; it is current", async () => {
    riverRate = await activeRate(river.relationshipId, 4250, 5800, addDays(ps, -30));
    const cards = await must(finance.client.rpc("list_rate_cards", { p_organisation_id: alphaId }));
    const card = cards.find((row) => row.rate_card_id === riverRate.cardId);
    expect(card?.facility_name).toBe("Riverside");
    expect(card?.versions).toEqual([
      expect.objectContaining({ status: "active", pay_rate_minor: 4250, bill_rate_minor: 5800 }),
    ]);
    const scheduler_ = await scheduler.client.rpc("create_rate_card", {
      p_organisation_id: alphaId,
      p_discipline_key: "cna",
    });
    expect(scheduler_.error?.code).toBe("CH403");
  });

  it("a locked timesheet is priced with exact integer arithmetic", async () => {
    wendySheet = await lockedTimesheet("wendy", river, CHICAGO, [
      { day: 1, start: "09:00", end: "17:00" },
      { day: 2, start: "09:00", end: "17:00", out: "16:33" },
    ]);
    const priced = await must(
      finance.client.rpc("price_timesheet", { p_timesheet_id: wendySheet, p_expected_revision: 1 }),
    );
    expect(priced[0]?.outcome).toBe("priced");
    firstPricing = priced[0]?.priced_timesheet_id ?? "";
    const [header] = await must(
      finance.client.rpc("get_priced_timesheet", { p_priced_timesheet_id: firstPricing }),
    );
    expect(header).toMatchObject({
      currency: "USD",
      total_raw_minutes: 933,
      total_pay_minor: 66088,
      total_bill_minor: 90190,
    });
    const lines = await must(
      finance.client.rpc("list_priced_timesheet_lines", { p_priced_timesheet_id: firstPricing }),
    );
    expect(
      lines.map((line) => [line.raw_minutes, line.pay_amount_minor, line.bill_amount_minor]),
    ).toEqual([
      [480, 34000, 46400],
      [453, 32088, 43790],
    ]);
    const again = await must(
      finance.client.rpc("price_timesheet", { p_timesheet_id: wendySheet, p_expected_revision: 1 }),
    );
    expect(again[0]).toMatchObject({ outcome: "existing", priced_timesheet_id: firstPricing });
  });

  it("a later rate change leaves history alone; later work uses the new rate", async () => {
    const v2 = await must(
      finance.client.rpc("create_rate_version", {
        p_rate_card_id: riverRate.cardId,
        p_currency: "USD",
        p_pay_rate_minor: 4400,
        p_bill_rate_minor: 6000,
        p_effective_from: addDays(ps, 3),
      }),
    );
    await run(finance.client.rpc("activate_rate_version", { p_version_id: v2 }));
    const [header] = await must(
      finance.client.rpc("get_priced_timesheet", { p_priced_timesheet_id: firstPricing }),
    );
    expect(header).toMatchObject({ total_pay_minor: 66088, total_bill_minor: 90190 });

    const waltSheet = await lockedTimesheet("walt", river, CHICAGO, [
      { day: 3, start: "09:00", end: "13:00" },
    ]);
    const priced = await must(
      finance.client.rpc("price_timesheet", { p_timesheet_id: waltSheet, p_expected_revision: 1 }),
    );
    const [walt] = await must(
      finance.client.rpc("get_priced_timesheet", {
        p_priced_timesheet_id: priced[0]?.priced_timesheet_id ?? "",
      }),
    );
    expect(walt).toMatchObject({ total_pay_minor: 17600, total_bill_minor: 24000 });
  });

  it("a new timesheet revision gets its own pricing record", async () => {
    await run(
      admin.client.rpc("reopen_timesheet", {
        p_timesheet_id: wendySheet,
        p_reason: "approved_in_error",
      }),
    );
    await run(w("wendy").identity.client.rpc("submit_timesheet", { p_timesheet_id: wendySheet }));
    await run(
      admin.client.rpc("approve_timesheet", { p_timesheet_id: wendySheet, p_expected_revision: 2 }),
    );
    const stale = await finance.client.rpc("price_timesheet", {
      p_timesheet_id: wendySheet,
      p_expected_revision: 1,
    });
    expect(stale.error?.code).toBe("CHM08");
    const priced = await must(
      finance.client.rpc("price_timesheet", { p_timesheet_id: wendySheet, p_expected_revision: 2 }),
    );
    expect(priced[0]?.priced_timesheet_id).not.toBe(firstPricing);
    const records = await must(
      finance.client
        .from("priced_timesheets")
        .select("timesheet_revision")
        .eq("timesheet_id", wendySheet),
    );
    expect(records.map((record) => record.timesheet_revision).sort()).toEqual([1, 2]);
  });

  it("S7: ending a relationship releases pending sign-offs; a missing rate then blocks pricing", async () => {
    const edSheet = await lockedTimesheet("ed", mercy, NEW_YORK, [
      { day: 4, start: "09:00", end: "13:00" },
    ]);
    const [before] = await must(admin.client.from("timesheets").select("status").eq("id", edSheet));
    expect(before?.status).toBe("agency_approved");
    const pending = await must(
      gammaAdmin.client.rpc("list_facility_timesheet_entries", {
        p_facility_organisation_id: gammaId,
      }),
    );
    expect(pending).toHaveLength(1);

    await run(
      admin.client.rpc("set_facility_relationship_status", {
        p_relationship_id: mercy.relationshipId,
        p_status: "ended",
      }),
    );
    const [after] = await must(
      admin.client.from("timesheets").select("status, revision").eq("id", edSheet),
    );
    expect(after?.status).toBe("locked");
    const history = await must(
      admin.client.rpc("list_timesheet_history", { p_timesheet_id: edSheet }),
    );
    expect(history.map((item) => item.action)).toContain("facility_signoff_not_required");
    const late = await gammaAdmin.client.rpc("facility_decide_timesheet_entry", {
      p_entry_id: pending[0]?.entry_id ?? "",
      p_expected_revision: 1,
      p_sign_off: true,
    });
    expect(late.error?.code).toBe("CHP12");

    const blocked = await must(
      finance.client.rpc("price_timesheet", { p_timesheet_id: edSheet, p_expected_revision: 1 }),
    );
    expect(blocked[0]?.outcome).toBe("blocked");
    expect(JSON.stringify(blocked[0]?.issues)).toContain("RATE_NOT_CONFIGURED");
    const queue = await must(
      finance.client.rpc("list_pricing_queue", {
        p_organisation_id: alphaId,
        p_state: "attention",
      }),
    );
    expect(queue.map((row) => row.timesheet_id)).toContain(edSheet);
    const none = await must(
      finance.client.from("priced_timesheets").select("id").eq("timesheet_id", edSheet),
    );
    expect(none).toEqual([]);
  });

  it("other tenants, facilities and workers never see rates or pricing", async () => {
    const betaQueue = await betaAdmin.client.rpc("list_pricing_queue", {
      p_organisation_id: alphaId,
      p_state: "priced",
    });
    expect(betaQueue.error?.code).toBe("CH403");
    for (const client of [
      betaAdmin.client,
      gammaAdmin.client,
      w("wendy").identity.client,
      scheduler.client,
    ]) {
      expect((await client.from("rate_card_versions").select("id")).data).toEqual([]);
      expect((await client.from("priced_timesheet_lines").select("id")).data).toEqual([]);
    }
    const workerPrice = await w("wendy").identity.client.rpc("get_priced_timesheet", {
      p_priced_timesheet_id: firstPricing,
    });
    expect(workerPrice.error?.code).toBe("CHM15");
    const entries = await must(
      w("wendy").identity.client.rpc("list_timesheet_entries", { p_timesheet_id: wendySheet }),
    );
    expect(JSON.stringify(entries)).not.toMatch(/rate|amount|pay_|bill_/);
  });
});
