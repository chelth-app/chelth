import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import { zonedLocalToInstant } from "@/lib/domain/attendance";

import { generateTotp } from "../support/totp";
import { arrangePastWork, createStaffingWorld, type StaffingWorld } from "./staffing-fixture";
import { expectNoPageOverflow, expectNoPaymentVocabulary, qaScreenshot, signIn } from "./support";

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const AFTER_ACTION = { timeout: 20_000 };
const TZ = "America/New_York";

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
  expect(results.violations).toEqual([]);
  // P0-E8-S2: wide tables scroll inside their region, never the page (412 px on mobile).
  await expectNoPageOverflow(page);
}

async function must<T>(promise: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await promise;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("no data");
  return data;
}

function at(date: string, time: string): string {
  const instant = zonedLocalToInstant(date, time, TZ);
  if (!instant) throw new Error("bad local time");
  return instant;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Monday two weeks back: a closed period under the default week start. */
function closedPeriodStart(): string {
  const date = new Date(Date.now() - 14 * 86_400_000);
  const isoDow = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (isoDow - 1));
  return date.toISOString().slice(0, 10);
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app$/, AFTER_ACTION);
  return page;
}

test.describe.serial("pay & bill rates and pricing", () => {
  test.setTimeout(240_000);

  let world: StaffingWorld;
  let riverside: { facilityId: string; locationId: string; relationshipId: string };
  let lakeside: { facilityId: string; locationId: string; relationshipId: string };
  let tiaSheet: string;
  let boSheet: string;
  let cySheet: string;
  const ps = closedPeriodStart();

  function person(key: string) {
    const who = world.extra[key];
    if (!who) throw new Error(`unknown worker ${key}`);
    return who;
  }

  async function unlinkedFacility(name: string) {
    const facilityId = await must(
      world.admin.client.rpc("create_agency_facility", {
        p_agency_organisation_id: world.agencyId,
        p_name: name,
        p_facility_type: "clinic",
        p_timezone: TZ,
      }),
    );
    const locationId = await must(
      world.admin.client.rpc("create_facility_location", {
        p_facility_id: facilityId,
        p_name: `${name} Ward`,
      }),
    );
    const relationshipId = await must(
      world.admin.client.rpc("create_facility_relationship", { p_facility_id: facilityId }),
    );
    await world.admin.client.rpc("set_facility_relationship_status", {
      p_relationship_id: relationshipId,
      p_status: "active",
    });
    return { facilityId, locationId, relationshipId };
  }

  /** Arranges past work, then the worker submits and the admin approves (API). */
  async function workedWeek(
    key: string,
    site: { facilityId: string; locationId: string },
    shifts: { day: number; start: string; end: string; out?: string }[],
  ): Promise<string> {
    let assignmentId = "";
    for (const shift of shifts) {
      const date = addDays(ps, shift.day);
      assignmentId = (
        await arrangePastWork(world, {
          worker: person(key),
          facilityId: site.facilityId,
          locationId: site.locationId,
          startAt: at(date, shift.start),
          endAt: at(date, shift.end),
          events: [
            { type: "clock_in", at: at(date, shift.start) },
            { type: "clock_out", at: at(date, shift.out ?? shift.end) },
          ],
        })
      ).assignmentId;
    }
    const [entry] = await must(
      world.admin.client
        .from("timesheet_entries")
        .select("timesheet_id")
        .eq("assignment_id", assignmentId),
    );
    const timesheetId = entry?.timesheet_id ?? "";
    const submitted = await person(key).client.rpc("submit_timesheet", {
      p_timesheet_id: timesheetId,
    });
    if (submitted.error) throw submitted.error;
    const approved = await world.admin.client.rpc("approve_timesheet", {
      p_timesheet_id: timesheetId,
      p_expected_revision: 1,
    });
    if (approved.error) throw approved.error;
    return timesheetId;
  }

  /** Admin in the browser, stepped up to AAL2 through the real verify page. */
  async function steppedUpAdmin(browser: Browser, path: string): Promise<Page> {
    const admin = await signedIn(browser, world.admin.email);
    await admin.goto(path);
    await admin.getByRole("link", { name: "Verify now" }).click();
    await admin.getByLabel("Authentication code").fill(generateTotp(world.admin.totpSecret ?? ""));
    await admin.getByRole("button", { name: "Verify" }).click();
    await expect(admin).toHaveURL(new RegExp(`${path}$`), AFTER_ACTION);
    return admin;
  }

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`pr-${testInfo.project.name.split("-")[0] ?? "e2e"}`, [
      { key: "tia", name: "Tia Priced", blsExpiryDays: 400 },
      { key: "bo", name: "Bo Blocked", blsExpiryDays: 400 },
      { key: "cy", name: "Cy Signoff", blsExpiryDays: 400 },
    ]);
    riverside = await unlinkedFacility("Riverside Clinic");
    lakeside = await unlinkedFacility("Lakeside Clinic");
    const locations = await must(
      world.admin.client
        .from("facility_locations")
        .select("id")
        .eq("agency_facility_id", world.facilityId),
    );
    tiaSheet = await workedWeek("tia", riverside, [
      { day: 1, start: "09:00", end: "17:00" },
      { day: 2, start: "09:00", end: "17:00", out: "16:33" },
    ]);
    boSheet = await workedWeek("bo", lakeside, [{ day: 3, start: "09:00", end: "13:00" }]);
    cySheet = await workedWeek(
      "cy",
      { facilityId: world.facilityId, locationId: locations[0]?.id ?? "" },
      [{ day: 4, start: "09:00", end: "13:00" }],
    );
  });

  test("Flow 1: a rate is created, activated and shown as current", async ({ browser }) => {
    const path = `/app/organisations/${world.agencyId}/rates`;
    const admin = await steppedUpAdmin(browser, path);
    await admin
      .getByRole("combobox", { name: "Facility" })
      .selectOption({ label: "Riverside Clinic" });
    await admin
      .getByRole("combobox", { name: "Discipline" })
      .selectOption({ label: "Certified Nursing Assistant (CNA)" });
    await admin.getByLabel("Pay rate per hour").first().fill("42.50");
    await admin.getByLabel("Bill rate per hour").first().fill("58.00");
    await admin.getByLabel("Effective from").first().fill(addDays(ps, -30));
    await admin.getByRole("button", { name: "Save draft rate" }).click();
    const versions = admin.getByRole("region", {
      name: "Versions: Riverside Clinic · Certified Nursing Assistant (CNA) · Any shift type",
    });
    await expect(versions).toContainText("Draft", AFTER_ACTION);
    await versions.getByRole("button", { name: /^Activate v1/ }).click();
    // P0-E8-S5: rate version status renders as a text chip; Rates | Pricing mode switch.
    await expect(versions.getByRole("row", { name: /v1/ })).toContainText("Current", AFTER_ACTION);
    await expect(
      admin.getByRole("navigation", { name: "Rates and pricing" }).getByRole("link", {
        name: "Rates",
      }),
    ).toHaveAttribute("aria-current", "page");
    await expectNoPaymentVocabulary(admin);
    await qaScreenshot(admin, "s5-rates");
    await expect(versions).toContainText("Current", AFTER_ACTION);
    await expect(versions).toContainText("$42.50/h");
    await expect(versions).toContainText("$58.00/h");
    await expectNoA11yViolations(admin);
    await admin.context().close();
  });

  test("Flow 2: a locked timesheet is priced with exact pay and bill amounts", async ({
    browser,
  }) => {
    const admin = await signedIn(browser, world.admin.email);
    await admin.goto(`/app/organisations/${world.agencyId}/pricing?state=ready`);
    const table = admin.getByRole("region", { name: "Ready for pricing table" });
    const row = table.getByRole("row", { name: /Tia Priced/ });
    await expect(row).toContainText("Ready for pricing");
    await qaScreenshot(admin, "pricing-finance-list");
    await expectNoA11yViolations(admin);
    await row.getByRole("button", { name: "Price timesheet for Tia Priced" }).click();
    await expect(row).toHaveCount(0, AFTER_ACTION);
    await admin.goto(`/app/organisations/${world.agencyId}/pricing?state=priced`);
    await admin.getByRole("link", { name: "Tia Priced" }).click();
    const lines = admin.getByRole("region", { name: "Priced lines" });
    await expect(lines).toContainText("$340.00");
    await expect(lines).toContainText("$464.00");
    await expect(lines).toContainText("$320.88");
    await expect(lines).toContainText("$437.90");
    await expect(admin.getByLabel("Totals")).toContainText("$660.88");
    await expect(admin.getByLabel("Totals")).toContainText("$901.90");
    await qaScreenshot(admin, "pricing-detail");
    await expectNoA11yViolations(admin);
    await admin.context().close();
  });

  test("Flow 3: a missing rate blocks pricing with guidance; adding the rate lets it price", async ({
    browser,
  }) => {
    const admin = await signedIn(browser, world.admin.email);
    await admin.goto(`/app/organisations/${world.agencyId}/pricing?state=ready`);
    await admin
      .getByRole("row", { name: /Bo Blocked/ })
      .getByRole("button", { name: "Price timesheet for Bo Blocked" })
      .click();
    // Blocked: the timesheet leaves "Ready" and waits under "Needs attention".
    await expect(admin.getByRole("row", { name: /Bo Blocked/ })).toHaveCount(0, AFTER_ACTION);
    await admin.goto(`/app/organisations/${world.agencyId}/pricing?state=attention`);
    const issues = admin.getByRole("list", { name: "Pricing issues for Bo Blocked" });
    await expect(issues).toContainText("No active rate for this work");
    await expect(admin.getByRole("link", { name: "Add or activate a rate" })).toBeVisible();
    await admin.context().close();

    // Finance adds the missing rate (API), then pricing succeeds.
    const cardId = await must(
      world.admin.client.rpc("create_rate_card", {
        p_organisation_id: world.agencyId,
        p_discipline_key: "cna",
        p_relationship_id: lakeside.relationshipId,
      }),
    );
    const versionId = await must(
      world.admin.client.rpc("create_rate_version", {
        p_rate_card_id: cardId,
        p_currency: "USD",
        p_pay_rate_minor: 4000,
        p_bill_rate_minor: 5500,
        p_effective_from: addDays(ps, -30),
      }),
    );
    const activated = await world.admin.client.rpc("activate_rate_version", {
      p_version_id: versionId,
    });
    if (activated.error) throw activated.error;

    const again = await signedIn(browser, world.admin.email);
    await again.goto(`/app/organisations/${world.agencyId}/pricing?state=attention`);
    await again
      .getByRole("row", { name: /Bo Blocked/ })
      .getByRole("button", { name: "Price again timesheet for Bo Blocked" })
      .click();
    await expect(again.getByRole("row", { name: /Bo Blocked/ })).toHaveCount(0, AFTER_ACTION);
    await again.goto(`/app/organisations/${world.agencyId}/pricing?state=priced`);
    const priced = again.getByRole("row", { name: /Bo Blocked/ });
    await expect(priced).toContainText("$160.00", AFTER_ACTION);
    await expect(priced).toContainText("$220.00");
    await again.context().close();
  });

  test("Flow 4: a future version is shown as upcoming; the current one stays", async ({
    browser,
  }) => {
    const path = `/app/organisations/${world.agencyId}/rates`;
    const admin = await steppedUpAdmin(browser, path);
    const scope = "Riverside Clinic · Certified Nursing Assistant (CNA) · Any shift type";
    const card = admin.getByRole("listitem", { name: scope });
    await card.getByText(`New version for ${scope}`).click();
    await card.getByLabel("Pay rate per hour").fill("44.00");
    await card.getByLabel("Bill rate per hour").fill("60.00");
    await card
      .getByLabel("Effective from")
      .fill(addDays(new Date().toISOString().slice(0, 10), 30));
    await card.getByRole("button", { name: "Save draft version" }).click();
    const versions = admin.getByRole("region", { name: `Versions: ${scope}` });
    await versions.getByRole("button", { name: /^Activate v2/ }).click();
    await expect(versions.getByRole("row", { name: /v2/ })).toContainText("Upcoming", AFTER_ACTION);
    await expect(versions.getByRole("row", { name: /v1/ })).toContainText("Current");
    await expect(versions.getByRole("row", { name: /v1/ })).toContainText("$42.50/h");
    await admin.context().close();
  });

  test("Flow 5: a facility cannot reach rates, pricing or pay data", async ({ browser }) => {
    const facility = await signedIn(browser, world.facilityAdmin.email);
    for (const path of [
      `/app/organisations/${world.agencyId}/rates`,
      `/app/organisations/${world.agencyId}/pricing`,
      `/app/organisations/${world.facilityOrgId}/rates`,
      `/app/organisations/${world.facilityOrgId}/pricing`,
    ]) {
      expect((await facility.goto(path))?.status()).toBe(404);
    }
    await facility.goto(`/app/organisations/${world.facilityOrgId}/timesheets`);
    await expect(facility.locator("main")).not.toContainText(/\$|pay rate|bill rate|margin/i);
    await facility.context().close();
  });

  test("Flow 6: a worker cannot reach rates or pricing", async ({ browser }) => {
    const tia = await signedIn(browser, person("tia").email);
    const [priced] = await must(
      world.admin.client.from("priced_timesheets").select("id").eq("timesheet_id", tiaSheet),
    );
    for (const path of [
      `/app/organisations/${world.agencyId}/rates`,
      `/app/organisations/${world.agencyId}/pricing`,
      `/app/organisations/${world.agencyId}/pricing/${priced?.id ?? ""}`,
    ]) {
      expect((await tia.goto(path))?.status()).toBe(404);
    }
    await tia.goto(`/app/organisations/${world.agencyId}/timesheets/${tiaSheet}`);
    await expect(tia.locator("main")).not.toContainText(/\$|rate/i);
    await tia.context().close();
    expect(boSheet).not.toBe("");
  });

  test("Flow 7: a relationship ending while sign-off is pending locks the timesheet, traceably", async ({
    browser,
  }) => {
    const facility = await signedIn(browser, world.facilityAdmin.email);
    await facility.goto(`/app/organisations/${world.facilityOrgId}/timesheets`);
    await expect(
      facility.getByRole("region", { name: "Facility timesheet entries" }),
    ).toContainText("Cy Signoff");
    await facility.context().close();

    const ended = await world.admin.client.rpc("set_facility_relationship_status", {
      p_relationship_id: world.relationshipId,
      p_status: "ended",
    });
    if (ended.error) throw ended.error;

    const admin = await signedIn(browser, world.admin.email);
    await admin.goto(`/app/organisations/${world.agencyId}/timesheets/${cySheet}`);
    await expect(admin.locator("main header")).toContainText("Locked");
    await expect(admin.getByRole("list", { name: "Timesheet history" })).toContainText(
      "Facility sign-off no longer required (relationship ended)",
    );
    await expect(admin.getByRole("region", { name: "Timesheet entries" })).toContainText(
      "No sign-off needed",
    );
    await admin.context().close();

    const after = await signedIn(browser, world.facilityAdmin.email);
    await after.goto(`/app/organisations/${world.facilityOrgId}/timesheets`);
    await expect(after.getByText("No entries awaiting sign-off.")).toBeVisible();
    await after.context().close();
  });
});
