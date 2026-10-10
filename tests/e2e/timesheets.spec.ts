import AxeBuilder from "@axe-core/playwright";
import {
  type Browser,
  type BrowserContextOptions,
  expect,
  type Page,
  test,
} from "@playwright/test";

import { zonedLocalToInstant } from "@/lib/domain/attendance";

import { generateTotp } from "../support/totp";
import {
  arrangePastWork,
  attachClockInEvidence,
  createStaffingWorld,
  type StaffingWorld,
} from "./staffing-fixture";
import {
  expectNoPageOverflow,
  openShiftAttendance,
  qaScreenshot,
  SIGNED_IN_LANDING,
  signIn,
} from "./support";

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

/** Monday of the week two weeks back (a closed period under the default week start). */
function closedPeriodStart(): string {
  const date = new Date(Date.now() - 14 * 86_400_000);
  const isoDow = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (isoDow - 1));
  return date.toISOString().slice(0, 10);
}

function localParts(instant: Date): { date: string; time: string } {
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

async function signedIn(
  browser: Browser,
  email: string,
  options: BrowserContextOptions = {},
): Promise<Page> {
  const page = await (await browser.newContext(options)).newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(SIGNED_IN_LANDING, AFTER_ACTION);
  return page;
}

test.describe.serial("timesheets & attendance review", () => {
  test.setTimeout(240_000);

  let world: StaffingWorld;
  let mainLocation: string;
  let riverside: { facilityId: string; locationId: string };
  let tiaMercy: string;
  let tiaSheet: string;
  let cyAssignment: string;
  const ps = closedPeriodStart();

  function person(key: string) {
    const who = world.extra[key];
    if (!who) throw new Error(`unknown worker ${key}`);
    return who;
  }

  async function timesheetOf(assignmentId: string): Promise<string> {
    const [entry] = await must(
      world.admin.client
        .from("timesheet_entries")
        .select("timesheet_id")
        .eq("assignment_id", assignmentId),
    );
    return entry?.timesheet_id ?? "";
  }

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`ts-${testInfo.project.name.split("-")[0] ?? "e2e"}`, [
      { key: "tia", name: "Tia Timesheet", blsExpiryDays: 400 },
      { key: "bo", name: "Bo Break", blsExpiryDays: 400 },
      { key: "cy", name: "Cy Correction", blsExpiryDays: 400 },
    ]);
    const locations = await must(
      world.admin.client
        .from("facility_locations")
        .select("id")
        .eq("agency_facility_id", world.facilityId),
    );
    mainLocation = locations[0]?.id ?? "";

    // A second, unlinked client facility: its work never reaches the facility user.
    const riversideId = await must(
      world.admin.client.rpc("create_agency_facility", {
        p_agency_organisation_id: world.agencyId,
        p_name: "Riverside Clinic",
        p_facility_type: "clinic",
        p_timezone: TZ,
      }),
    );
    const riversideLocation = await must(
      world.admin.client.rpc("create_facility_location", {
        p_facility_id: riversideId,
        p_name: "Riverside Ward",
      }),
    );
    const riversideRelationship = await must(
      world.admin.client.rpc("create_facility_relationship", { p_facility_id: riversideId }),
    );
    await world.admin.client.rpc("set_facility_relationship_status", {
      p_relationship_id: riversideRelationship,
      p_status: "active",
    });
    riverside = { facilityId: riversideId, locationId: riversideLocation };

    // Tia: last closed week — Mercy 09:00–17:00 with a 12:00–12:30 break; Riverside 09:00–13:00.
    const day1 = addDays(ps, 1);
    const day2 = addDays(ps, 2);
    tiaMercy = (
      await arrangePastWork(world, {
        worker: person("tia"),
        facilityId: world.facilityId,
        locationId: mainLocation,
        startAt: at(day1, "09:00"),
        endAt: at(day1, "17:00"),
        events: [
          { type: "clock_in", at: at(day1, "09:00") },
          { type: "break_start", at: at(day1, "12:00") },
          { type: "break_end", at: at(day1, "12:30") },
          { type: "clock_out", at: at(day1, "17:00") },
        ],
      })
    ).assignmentId;
    await arrangePastWork(world, {
      worker: person("tia"),
      facilityId: riverside.facilityId,
      locationId: riverside.locationId,
      startAt: at(day2, "09:00"),
      endAt: at(day2, "13:00"),
      events: [
        { type: "clock_in", at: at(day2, "09:00") },
        { type: "clock_out", at: at(day2, "13:00") },
      ],
    });
    tiaSheet = await timesheetOf(tiaMercy);

    // Cy: yesterday at Mercy, clocked in, never clocked out.
    const yesterday = localParts(new Date(Date.now() - 86_400_000)).date;
    cyAssignment = (
      await arrangePastWork(world, {
        worker: person("cy"),
        facilityId: world.facilityId,
        locationId: mainLocation,
        startAt: at(yesterday, "09:00"),
        endAt: at(yesterday, "13:00"),
        events: [{ type: "clock_in", at: at(yesterday, "09:00") }],
      })
    ).assignmentId;
  });

  test("Flow 1: a worker's completed week appears as a timesheet and is submitted", async ({
    browser,
  }) => {
    const tia = await signedIn(browser, person("tia").email);
    await tia.goto(`/app/organisations/${world.agencyId}/timesheets`);
    const week = tia.getByRole("list", { name: "My timesheets" }).getByRole("listitem").first();
    await expect(week).toContainText("Ready to submit");
    await expect(week).toContainText("11 h 30 min worked");
    await expectNoA11yViolations(tia);
    await week.getByRole("link").click();
    const entries = tia.getByRole("region", { name: "Timesheet entries" });
    await expect(entries).toContainText("7 h 30 min");
    await expect(entries).toContainText("4 h");
    await qaScreenshot(tia, "s6-timesheet-detail");
    await tia.getByRole("button", { name: "Submit timesheet" }).click();
    // The page re-renders from the database: the form is gone and the status has changed.
    await expect(tia.locator("main header")).toContainText("Submitted", AFTER_ACTION);
    await expect(tia.getByRole("button", { name: "Submit timesheet" })).toHaveCount(0);
    await expectNoA11yViolations(tia);
    await tia.context().close();
  });

  test("Timesheets at the reference canvas, with Timesheet Details open (P0-E8-S9E)", async ({
    browser,
  }) => {
    const admin = await signedIn(browser, world.admin.email);
    await admin.setViewportSize({ width: 1512, height: 996 });
    await admin.goto(`/app/organisations/${world.agencyId}/timesheets`);
    await expect(admin.getByRole("heading", { level: 1, name: "Timesheets" })).toBeVisible();
    const kpis = admin.getByRole("region", { name: "Timesheets by status" });
    await expect(kpis.getByRole("link", { name: /Needs Review/ })).toContainText("1");
    const table = admin.getByRole("region", { name: "Agency timesheets table" });
    const row = table.getByRole("row", { name: /Tia Timesheet/ });
    await expect(row).toContainText("Submitted");
    await expect(row).toContainText("11 h 30 min");
    await expect(admin.getByRole("region", { name: "Timesheet activity table" })).toContainText(
      "Submitted",
    );
    await qaScreenshot(admin, "tsqa-timesheets");

    await row.getByRole("button", { name: /^Details for Tia Timesheet/ }).click();
    const drawer = admin.getByRole("dialog", { name: "Timesheet Details" });
    await expect(drawer).toContainText("Time Details");
    await expect(drawer).toContainText("Attendance (derived)");
    await expect(drawer).toContainText("Audit History");
    await expect(drawer.getByRole("link", { name: "Review and approve" })).toHaveAttribute(
      "href",
      `/app/organisations/${world.agencyId}/timesheets/${tiaSheet}#review-heading`,
    );
    await expect(drawer).not.toContainText(/\$|latitude|longitude/i);
    await expectNoA11yViolations(admin);
    await qaScreenshot(admin, "tsqa-timesheets-drawer");
    const audit = drawer.getByRole("list", { name: "Tia Timesheet timesheet history" }).first();
    await expect(audit).toContainText("Submitted");
    await audit.scrollIntoViewIfNeeded();
    await qaScreenshot(admin, "tsqa-timesheets-drawer-history");
    await admin.keyboard.press("Escape");
    // At 1536 px the locked drawer docks beside the work area, as in the reference.
    await admin.setViewportSize({ width: 1536, height: 1024 });
    await row.getByRole("button", { name: /^Details for Tia Timesheet/ }).click();
    await expect(drawer).toBeVisible();
    await expectNoPageOverflow(admin);
    await qaScreenshot(admin, "tsqa-timesheets-docked");
    await admin.keyboard.press("Escape");
    await admin.setViewportSize({ width: 1512, height: 996 });

    await row.getByRole("link", { name: "Tia Timesheet" }).click();
    await expect(
      admin.getByRole("navigation", { name: "Timesheet record sections" }),
    ).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Facility sign-off" })).toBeVisible();
    await expectNoA11yViolations(admin);
    await qaScreenshot(admin, "tsqa-timesheet-record");

    await admin.goto(`/app/organisations/${world.agencyId}/timesheets`);
    for (const [width, height] of [
      [1280, 900],
      [768, 1024],
      [412, 915],
      [375, 812],
    ] as const) {
      await admin.setViewportSize({ width, height });
      await expectNoPageOverflow(admin);
      await qaScreenshot(admin, "tsqa-timesheets");
    }
    await admin.context().close();
  });

  test("Flow 2: the agency reviewer sees the attendance history and approves", async ({
    browser,
  }) => {
    const admin = await signedIn(browser, world.admin.email);
    await admin.goto(`/app/organisations/${world.agencyId}/timesheets`);
    const row = admin
      .getByRole("region", { name: "Agency timesheets table" })
      .getByRole("row", { name: /Tia Timesheet/ });
    await expect(row).toContainText("Submitted");
    await expectNoA11yViolations(admin);
    await row.getByRole("link", { name: "Tia Timesheet" }).click();
    await admin.getByRole("link", { name: "Attendance history" }).first().click();
    const history = admin.getByRole("region", { name: "Attendance history" });
    await expect(history).toContainText("Break start");
    await expect(history).toContainText("Clock-out");
    await expectNoA11yViolations(admin);
    await admin.goto(`/app/organisations/${world.agencyId}/timesheets/${tiaSheet}`);
    // P0-E8-QA-F3: Recalculate is the outlined secondary (not plain text), 44 px on
    // phones and the compact 36 px from sm; the shared filter controls are 44 px inside.
    const recalc = admin.getByRole("button", { name: "Recalculate from attendance" });
    await expect(recalc).toHaveCSS("border-top-width", "1px");
    await expect(recalc).toHaveCSS("font-weight", "600");
    const viewport = admin.viewportSize();
    await admin.setViewportSize({ width: 375, height: 900 });
    expect((await recalc.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expectNoA11yViolations(admin);
    await admin.goto(`/app/organisations/${world.agencyId}/timesheets`);
    const filters = admin.getByRole("form", { name: "Filter timesheets" });
    for (const height of await filters
      .locator("select, input:not([type=hidden])")
      .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height))) {
      expect(height).toBeGreaterThanOrEqual(44);
    }
    await expectNoA11yViolations(admin);
    await admin.setViewportSize({ width: 1280, height: 900 });
    await admin.goto(`/app/organisations/${world.agencyId}/timesheets/${tiaSheet}`);
    expect((await recalc.boundingBox())?.height ?? 0).toBe(36);
    if (viewport) await admin.setViewportSize(viewport);
    await admin.getByRole("button", { name: "Approve timesheet" }).click();
    await expect(admin.locator("main header")).toContainText(
      "Approved, awaiting facility",
      AFTER_ACTION,
    );
    await admin.context().close();
  });

  test("Flow 3: the facility sees only its own entry and signs it off", async ({ browser }) => {
    const facility = await signedIn(browser, world.facilityAdmin.email);
    await facility.goto(`/app/organisations/${world.facilityOrgId}/timesheets`);
    const table = facility.getByRole("region", { name: "Facility timesheet entries" });
    await expect(table).toContainText("Tia Timesheet");
    await expect(table).toContainText("7 h 30 min");
    await expect(facility.locator("main")).not.toContainText(/Riverside|40\.71|latitude/i);
    await expectNoA11yViolations(facility);
    // P0-E8-S4: the entry drawer shows only the facility projection.
    const details = table.getByRole("button", { name: /^Details for Tia Timesheet/ });
    await details.click();
    const drawer = facility.getByRole("dialog", { name: "Timesheet Details" });
    await expect(drawer).toContainText("Awaiting sign-off");
    await expect(drawer).not.toContainText(/\$|latitude|longitude|40\.71/i);
    await facility.keyboard.press("Escape");
    await expect(details).toBeFocused();
    await table.getByRole("button", { name: "Sign off Tia Timesheet" }).click();
    await expect(table).toContainText("Signed off", AFTER_ACTION);
    await facility.context().close();

    const [sheet] = await must(
      world.admin.client.from("timesheets").select("status").eq("id", tiaSheet),
    );
    expect(sheet?.status).toBe("locked");
  });

  test("Flow 4: a correction is approved with an adjusted time and the timesheet recalculates", async ({
    browser,
  }) => {
    const cy = await signedIn(browser, person("cy").email);
    const card = await openShiftAttendance(cy, world.agencyId);
    await card.getByText("Request a time correction").click();
    await card.getByRole("combobox", { name: "Which time?" }).selectOption("clock_out");
    await card
      .getByRole("combobox", { name: "Reason" })
      .selectOption({ label: "I forgot to clock" });
    await card.getByLabel("Actual time").fill("13:10");
    await card.getByRole("button", { name: "Send correction request" }).click();
    await expect(card.getByText("Correction requested. Your agency will review it.")).toBeVisible(
      AFTER_ACTION,
    );

    const admin = await signedIn(browser, world.admin.email);
    const yesterday = localParts(new Date(Date.now() - 86_400_000)).date;
    const today = localParts(new Date()).date;
    await admin.goto(
      `/app/organisations/${world.agencyId}/attendance?from=${yesterday}&to=${today}`,
    );
    const request = admin
      .getByRole("list", { name: "Correction requests" })
      .getByRole("listitem")
      .filter({ hasText: "Cy Correction" });
    await request.getByText("Approve a different time").click();
    await request.getByRole("textbox", { name: "Approved time", exact: true }).fill("13:00");
    await request
      .getByRole("combobox", { name: "Reason for the different time" })
      .selectOption({ label: "Supervisor observation" });
    await request
      .getByRole("button", { name: "Approve a different time for Cy Correction" })
      .click();
    await expect(admin.getByText("No correction requests waiting.")).toBeVisible(AFTER_ACTION);
    await admin.context().close();

    await cy.reload();
    await expect(cy.getByRole("list", { name: "My correction requests" })).toContainText("instead");
    await cy.goto(
      `/app/organisations/${world.agencyId}/timesheets/${await timesheetOf(cyAssignment)}`,
    );
    const entries = cy.getByRole("region", { name: "Timesheet entries" });
    await expect(entries).toContainText("4 h");
    await expect(entries).toContainText("1 approved correction");
    await cy.context().close();
  });

  test("Flow 5: a worker takes a break; the break is recorded and excluded from worked time", async ({
    browser,
  }) => {
    const start = localParts(new Date(Date.now() - 5 * 60_000));
    const end = localParts(new Date(Date.now() + 180 * 60_000));
    const shiftId = await must(
      world.scheduler.client.rpc("create_shift", {
        p_agency_facility_id: world.facilityId,
        p_facility_location_id: mainLocation,
        p_discipline_key: "cna",
        p_shift_date: start.date,
        p_start_time: start.time,
        p_end_time: end.time,
        p_requested_headcount: 2,
        p_open: true,
      }),
    );
    const decision = await must(
      world.scheduler.client.rpc("assign_worker_to_shift", {
        p_shift_id: shiftId,
        p_agency_worker_id: person("bo").workerId,
      }),
    );
    const assignmentId = decision[0]?.assignment_id ?? "";
    const accepted = await person("bo").client.rpc("accept_shift_assignment", {
      p_assignment_id: assignmentId,
    });
    if (accepted.error) throw accepted.error;

    const bo = await signedIn(browser, person("bo").email);
    const card = await openShiftAttendance(bo, world.agencyId);
    await bo.getByRole("button", { name: "Check In at Mercy Rehab" }).click();
    await expect(card).toContainText(/Clocked in|Needs review/, AFTER_ACTION);
    await bo.getByRole("button", { name: "Start break at Mercy Rehab" }).click();
    await expect(bo.getByRole("button", { name: "End break at Mercy Rehab" })).toBeVisible(
      AFTER_ACTION,
    );
    await expect(bo.getByRole("button", { name: "Check Out at Mercy Rehab" })).toHaveCount(0);
    await expectNoA11yViolations(bo);
    await bo.getByRole("button", { name: "End break at Mercy Rehab" }).click();
    await bo.getByRole("button", { name: "Check Out at Mercy Rehab" }).click();
    await expect(card).toContainText("Worked", AFTER_ACTION);

    await bo.goto(
      `/app/organisations/${world.agencyId}/timesheets/${await timesheetOf(assignmentId)}`,
    );
    const entries = bo.getByRole("region", { name: "Timesheet entries" });
    await expect(entries).not.toContainText("None");
    await bo.context().close();

    // The arranged 30-minute break is excluded: 8 scheduled hours, 7 h 30 min worked.
    const [entry] = await must(
      world.admin.client
        .from("timesheet_entries")
        .select("worked_minutes, break_minutes")
        .eq("assignment_id", tiaMercy),
    );
    expect(entry).toEqual({ worked_minutes: 450, break_minutes: 30 });
  });

  test("Flow 6: the admin steps up to view raw evidence; the facility never sees coordinates", async ({
    browser,
  }) => {
    const attendanceId = await attachClockInEvidence(tiaMercy);
    const admin = await signedIn(browser, world.admin.email);
    await admin.goto(`/app/organisations/${world.agencyId}/attendance/${attendanceId}`);
    await admin.getByRole("link", { name: "Verify now" }).click();
    await admin.getByLabel("Authentication code").fill(generateTotp(world.admin.totpSecret ?? ""));
    await admin.getByRole("button", { name: "Verify" }).click();
    await expect(admin).toHaveURL(/\/evidence$/, AFTER_ACTION);
    await expect(admin.getByRole("note")).toContainText("not proof of presence");
    const table = admin.getByRole("region", { name: "Location evidence table" });
    await expect(table).toContainText("40.71280, -74.00600");
    await expect(table).toContainText("Inside site area");
    // P0-E8-QA-F3: the evidence page is on the locked record family.
    await expect(admin.getByRole("main").locator(".chelth-locked")).toHaveCount(1);
    await expect(admin.getByRole("heading", { level: 1, name: "Location evidence" })).toHaveCSS(
      "font-weight",
      "700",
    );
    await expect(
      admin.getByRole("heading", { level: 2, name: "Retention and legal hold" }),
    ).toHaveCSS("font-size", "20px");
    await expectNoA11yViolations(admin);
    await qaScreenshot(admin, "qaf3-attendance-evidence");
    await admin.setViewportSize({ width: 375, height: 900 });
    await expectNoA11yViolations(admin);
    await qaScreenshot(admin, "qaf3-attendance-evidence");
    await admin.context().close();

    const facility = await signedIn(browser, world.facilityAdmin.email);
    const evidencePath = `/app/organisations/${world.agencyId}/attendance/${attendanceId}/evidence`;
    expect((await facility.goto(evidencePath))?.status()).toBe(404);
    await facility.goto(`/app/organisations/${world.facilityOrgId}/timesheets`);
    await expect(facility.locator("main")).not.toContainText(/40\.71|74\.00|latitude|longitude/i);
    await facility.context().close();
  });

  test("Flow 7: other tenants and other workers cannot reach timesheets", async ({ browser }) => {
    const beta = await signedIn(browser, world.betaAdmin.email);
    expect((await beta.goto(`/app/organisations/${world.agencyId}/timesheets`))?.status()).toBe(
      404,
    );
    expect(
      (await beta.goto(`/app/organisations/${world.agencyId}/timesheets/${tiaSheet}`))?.status(),
    ).toBe(404);
    await beta.context().close();
    const facility = await signedIn(browser, world.facilityAdmin.email);
    expect(
      (
        await facility.goto(`/app/organisations/${world.agencyId}/timesheets/${tiaSheet}`)
      )?.status(),
    ).toBe(404);
    await facility.context().close();
    const other = await signedIn(browser, person("bo").email);
    expect(
      (await other.goto(`/app/organisations/${world.agencyId}/timesheets/${tiaSheet}`))?.status(),
    ).toBe(404);
    await other.context().close();
  });
});
