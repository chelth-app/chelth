import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import {
  createStaffingWorld,
  facilityMember,
  isoDay,
  type StaffingWorld,
} from "./staffing-fixture";
import {
  expectNoPageOverflow,
  openShiftAttendance,
  qaScreenshot,
  SIGNED_IN_LANDING,
  signIn,
} from "./support";

/*
 * P0-E8-S6 Worker Mobile (P7): the worker self-service shell, bottom
 * navigation of real destinations, My shifts (accept, shift details, tabs),
 * the attendance flow (clock in, break, clock out, correction entry point),
 * workspace switching, and privacy (own data only, no finance surfaces).
 */

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const AFTER_ACTION = { timeout: 20_000 };
const TZ = "America/New_York";

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
  expect(results.violations).toEqual([]);
  await expectNoPageOverflow(page);
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(SIGNED_IN_LANDING, AFTER_ACTION);
  return page;
}

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

test.describe.serial("worker mobile experience", () => {
  test.setTimeout(240_000);

  let world: StaffingWorld;

  async function shiftFor(
    workerId: string,
    start: { date: string; time: string },
    end: { date: string; time: string },
  ): Promise<string> {
    const locations = await world.admin.client
      .from("facility_locations")
      .select("id")
      .eq("agency_facility_id", world.facilityId);
    if (locations.error) throw locations.error;
    const shift = await world.scheduler.client.rpc("create_shift", {
      p_agency_facility_id: world.facilityId,
      p_facility_location_id: locations.data[0]?.id ?? "",
      p_discipline_key: "cna",
      p_shift_date: start.date,
      p_start_time: start.time,
      p_end_time: end.time,
      p_requested_headcount: 2,
      p_open: true,
    });
    if (shift.error) throw shift.error;
    const decision = await world.scheduler.client.rpc("assign_worker_to_shift", {
      p_shift_id: shift.data,
      p_agency_worker_id: workerId,
    });
    if (decision.error) throw decision.error;
    return decision.data[0]?.assignment_id ?? "";
  }

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`wm-${testInfo.project.name.split("-")[0] ?? "e2e"}`, [
      { key: "wes", name: "Wes Worker", blsExpiryDays: 400 },
    ]);
    const wes = world.extra.wes;
    if (!wes) throw new Error("fixture");
    // Wes: an accepted shift starting now (Mercy Main checks no location).
    const assignment = await shiftFor(
      wes.workerId,
      local(new Date(Date.now() - 2 * 60_000)),
      local(new Date(Date.now() + 180 * 60_000)),
    );
    const accepted = await wes.client.rpc("accept_shift_assignment", {
      p_assignment_id: assignment,
    });
    if (accepted.error) throw accepted.error;
    // Wendy: a future assignment to accept, and a second membership to switch to.
    const wendyWorker = await world.wendy.client
      .from("agency_workers")
      .select("id")
      .eq("agency_organisation_id", world.agencyId);
    if (wendyWorker.error) throw wendyWorker.error;
    await shiftFor(
      wendyWorker.data[0]?.id ?? "",
      { date: isoDay(4), time: "07:00" },
      { date: isoDay(4), time: "15:00" },
    );
    await facilityMember(world, "", "", "facility.supervisor", world.wendy);
  });

  test("worker shell: bottom navigation of real destinations; More sheet switches workspace", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.wendy.email);
    await page.goto(`/app/organisations/${world.agencyId}/my-shifts`);
    const nav = page.getByRole("navigation", { name: "Worker" });
    await expect(nav.getByRole("link")).toHaveText(["Shifts", "Timesheets", "Credentials"]);
    await expect(nav.getByRole("link", { name: "Shifts" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Workspace" })).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Workspace sidebar" })).toHaveCount(0);

    const more = nav.getByRole("button", { name: "More" });
    await more.click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Account" })).toHaveAttribute(
      "href",
      "/app/account",
    );
    await expect(sheet.getByRole("link", { name: "Security" })).toHaveAttribute(
      "href",
      "/app/security",
    );
    await expect(sheet.getByRole("link", { name: "All workspaces" })).toHaveAttribute(
      "href",
      "/app",
    );
    await expect(sheet.getByRole("button", { name: "Sign out" })).toBeVisible();
    const switchList = sheet.getByRole("list", { name: "Switch workspace" });
    await expect(switchList).toContainText(world.facilityOrgName);
    await qaScreenshot(page, "s6-more-sheet");
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();

    // Switching uses the existing selectOrganisationAction.
    await more.click();
    await switchList.getByRole("button", { name: new RegExp(world.facilityOrgName) }).click();
    await expect(page).toHaveURL(new RegExp(`/app/organisations/${world.facilityOrgId}$`));
    await page.context().close();
  });

  test("My Shifts: Today / Upcoming / Past, accept, Shift Details screen (P0-E9-3D)", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.wendy.email);
    await page.goto(`/app/organisations/${world.agencyId}/my-shifts`);
    const tabs = page.getByRole("navigation", { name: "Shift period" });
    await expect(tabs.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
    // Nothing today: the next shift is shown (in 4 days).
    await expect(page.getByRole("heading", { level: 2, name: "Next Shift" })).toBeVisible();
    const assignments = page.getByRole("list", { name: "My assignments" });
    await expect(assignments).toContainText("Mercy Rehab");
    await qaScreenshot(page, "s6-my-shifts");
    await expectNoA11yViolations(page);

    await page.getByRole("button", { name: "Accept shift at Mercy Rehab" }).click();
    await expect(assignments).toContainText("Accepted", AFTER_ACTION);

    await assignments.getByRole("link", { name: /^Shift details: Mercy Rehab/ }).click();
    await expect(page).toHaveURL(/\/my-shifts\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Mercy Rehab" })).toBeVisible();
    const facts = page.getByRole("region", { name: "Shift facts" });
    await expect(facts).toContainText("Certified Nursing Assistant");
    await expect(page.getByRole("main")).toContainText("Accepted");
    // Own data only: no other workers, no pay or bill values.
    await expect(page.getByRole("main")).not.toContainText(/Nina|Wes|\$/);
    await qaScreenshot(page, "s6-shift-detail");
    await expectNoA11yViolations(page);
    await page.getByRole("link", { name: "My Shifts" }).first().click();
    await expect(page).toHaveURL(/\/my-shifts$/);

    await tabs.getByRole("link", { name: "Upcoming" }).click();
    await expect(page).toHaveURL(/view=upcoming/);
    await expect(page.getByRole("list", { name: "My assignments" })).toContainText("Mercy Rehab");
    await tabs.getByRole("link", { name: "Past" }).click();
    await expect(page).toHaveURL(/view=past/);
    await expect(page.getByText("No past assignments.")).toBeVisible();
    await page.context().close();
  });

  test("attendance: clock in, break, clock out, correction entry — without location prompts", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.extra.wes?.email ?? "");
    const card = await openShiftAttendance(page, world.agencyId);
    await expect(card).toContainText("Not started");

    // This site does not check location: no explanation, no browser prompt.
    await page.getByRole("button", { name: "Check In at Mercy Rehab" }).click();
    await expect(page.getByRole("region", { name: "Location check" })).toHaveCount(0);
    await expect(card).toContainText(/Clocked in|Needs review/, AFTER_ACTION);
    await qaScreenshot(page, "s6-clocked-in");

    await page.getByRole("button", { name: "Start break at Mercy Rehab" }).click();
    await expect(card).toContainText("You are on a break", AFTER_ACTION);
    await expect(page.getByRole("button", { name: "Check Out at Mercy Rehab" })).toHaveCount(0);
    await qaScreenshot(page, "s6-break-active");
    await expectNoA11yViolations(page);
    await page.getByRole("button", { name: "End break at Mercy Rehab" }).click();

    // Clock-out is available again once the break ends.
    const clockOut = page.getByRole("button", { name: "Check Out at Mercy Rehab" });
    await expect(clockOut).toBeEnabled(AFTER_ACTION);
    await clockOut.click();
    await expect(card).toContainText(/Completed|Needs review/, AFTER_ACTION);
    await qaScreenshot(page, "s6-clocked-out");

    // Corrections are requests added alongside the record, never edits of it.
    await card.getByText("Request a time correction").click();
    await expect(card).toContainText("Your original clock record stays exactly as recorded");
    await expect(card.getByRole("button", { name: "Send correction request" })).toBeVisible();
    await qaScreenshot(page, "s6-correction-request");
    await expectNoA11yViolations(page);
    await page.context().close();
  });

  test("W1: after clock-out the attendance hands off to the worker's own timesheet (P0-E8-W1)", async ({
    browser,
  }) => {
    // Wes clocked in and out in the attendance test above (serial suite).
    const page = await signedIn(browser, world.extra.wes?.email ?? "");
    const card = await openShiftAttendance(page, world.agencyId);
    // P0-E9-3D: the canonical Worked Time handoff, prefilled from attendance.
    await expect(card).toContainText("Worked Time");
    await expect(card.locator('dl[aria-label="Worked time"]')).toContainText("Check Out");
    // Worker-friendly outcome only: no coordinates, no pay values.
    await expect(page.getByRole("main")).not.toContainText(/latitude|longitude|\$\d/i);
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "w1-handoff");
    await card
      .getByRole("link", { name: /^(View timesheet|Review and submit timesheet)$/ })
      .click();
    await expect(page).toHaveURL(/\/timesheets\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "My timesheet" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Worker" }).getByRole("link", { name: "Timesheets" }),
    ).toHaveAttribute("aria-current", "page");
    await page.context().close();
  });

  test("W1: My Shifts at phone widths — one column, bottom navigation, no overflow (P0-E8-W1)", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.wendy.email);
    for (const width of [375, 390, 412, 430, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organisations/${world.agencyId}/my-shifts`);
      await expect(page.getByRole("heading", { level: 1, name: "My Shifts" })).toBeVisible();
      const nav = page.getByRole("navigation", { name: "Worker" });
      await expect(nav.getByRole("link", { name: "Shifts" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      // Every bottom-navigation target is at least 44 px.
      for (const box of await nav
        .locator("a, button")
        .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height))) {
        expect(box).toBeGreaterThanOrEqual(44);
      }
      const details = page
        .getByRole("list", { name: "My assignments" })
        .getByRole("link", { name: /^Shift details: Mercy Rehab/ })
        .first();
      expect((await details.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expectNoPageOverflow(page);
      if (width === 375 || width === 412) await expectNoA11yViolations(page);
      await qaScreenshot(page, "w1-my-shifts");
    }
    await page.context().close();
  });

  test("W1: staff and facility users never get the worker navigation (P0-E8-W1)", async ({
    browser,
  }) => {
    for (const who of [world.scheduler, world.facilityAdmin]) {
      const page = await signedIn(browser, who.email);
      const own = who === world.facilityAdmin ? world.facilityOrgId : world.agencyId;
      await page.goto(`/app/organisations/${own}`);
      await expect(page.getByRole("navigation", { name: "Worker" })).toHaveCount(0);
      expect((await page.goto(`/app/organisations/${world.agencyId}/my-shifts`))?.status()).toBe(
        404,
      );
      await expect(page.getByRole("navigation", { name: "Worker" })).toHaveCount(0);
      await page.context().close();
    }
  });

  test("timesheets and credentials stay worker-scoped; no finance or agency surfaces", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.extra.wes?.email ?? "");
    const base = `/app/organisations/${world.agencyId}`;
    const nav = page.getByRole("navigation", { name: "Worker" });

    await page.goto(`${base}/timesheets`);
    await expect(page.getByRole("heading", { level: 1, name: "Timesheets" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Timesheets" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("main")).not.toContainText(/Wendy|Nina|\$/);
    await qaScreenshot(page, "s6-timesheets");
    await expectNoA11yViolations(page);

    await page.goto(`${base}/my-credentials`);
    await expect(nav.getByRole("link", { name: "Credentials" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("link", { name: "Add credential" })).toHaveAttribute(
      "href",
      `${base}/my-credentials/new`,
    );
    await qaScreenshot(page, "s6-credentials");
    await expectNoA11yViolations(page);

    for (const path of [
      "payroll",
      "invoices",
      "pricing",
      "rates",
      "workforce",
      "attendance",
      "operations",
      "shifts",
    ]) {
      expect((await page.goto(`${base}/${path}`))?.status(), path).toBe(404);
    }
    await page.context().close();
  });

  test("QA-F2: worker Timesheets on the locked worker system (P0-E8-QA-F2)", async ({
    browser,
  }) => {
    // Wes has a real week from the attendance test above (serial suite).
    const page = await signedIn(browser, world.extra.wes?.email ?? "");
    const base = `/app/organisations/${world.agencyId}`;
    const nav = page.getByRole("navigation", { name: "Worker" });
    for (const width of [375, 390, 412, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/timesheets`);
      const heading = page.getByRole("heading", { level: 1, name: "Timesheets" });
      await expect(heading).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("main").locator(".chelth-locked")).toHaveCount(1);
      await expect(heading).toHaveCSS("font-weight", "700");
      if (width >= 640) await expect(heading).toHaveCSS("font-size", "31.5px");
      await expect(nav.getByRole("link", { name: "Timesheets" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      // Worker self-service: no agency back-link in the header.
      await expect(
        page.getByRole("main").locator("header").getByRole("link", { name: world.agencyName }),
      ).toHaveCount(0);
      const week = page.getByRole("list", { name: "My timesheets" }).getByRole("listitem").first();
      await expect(week).toContainText("Weekly timesheet");
      await expect(week).toContainText(/worked · \d+ shifts?/);
      await expect(week).toContainText(/Open|Submitted|Returned|Approved|Locked/);
      // Worked time only: never pay, bill or payroll values.
      await expect(page.getByRole("main")).not.toContainText(/\$|£|€|pay rate|bill rate|payroll/i);
      const open = week.getByRole("link", { name: /^(View timesheet|Review and submit), week / });
      expect((await open.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expectNoPageOverflow(page);
      if (width === 375 || width === 1280) await expectNoA11yViolations(page);
      await qaScreenshot(page, "qaf2-worker-timesheets");
    }
    await page.context().close();
  });

  test("QA-F2: My Credentials and its record on the locked worker system (P0-E8-QA-F2)", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.extra.wes?.email ?? "");
    const base = `/app/organisations/${world.agencyId}`;
    const nav = page.getByRole("navigation", { name: "Worker" });
    const iso = /\b\d{4}-\d{2}-\d{2}\b/;
    const readable = /[A-Z][a-z]{2} \d{1,2}, \d{4}/;
    for (const width of [375, 390, 412, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/my-credentials`);
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toHaveText("My Credentials");
      await expect(heading).toHaveCSS("font-weight", "700");
      if (width >= 640) await expect(heading).toHaveCSS("font-size", "31.5px");
      await expect(page.getByRole("main").locator(".chelth-locked")).toHaveCount(1);
      await expect(nav.getByRole("link", { name: "Credentials" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      // Readiness: the engine's result in the locked worker card, readable dates.
      const readiness = page.getByRole("region", { name: `Readiness at ${world.agencyName}` });
      await expect(readiness.getByRole("heading", { level: 2 })).toHaveCSS("font-size", "20px");
      await expect(readiness).toContainText(/Ready|Action required|Not eligible/);
      await expect(readiness).toContainText(readable);
      await expect(page.getByRole("main")).not.toContainText(iso);
      await expect(page.getByRole("main")).not.toContainText("✓");
      // Canonical chips (glyph chips), not legacy dot chips.
      const cards = page.getByRole("list", { name: "My credentials" });
      const shared = cards.getByText(`Shared with ${world.agencyName}`).first();
      await expect(shared.locator("svg")).toHaveCount(1);
      await expect(cards).toContainText(/Expires [A-Z][a-z]{2} \d{1,2}, \d{4}/);
      // P0-E9-3C: one state chip per credential, from real version and review data.
      await expect(cards).toContainText(/Verified|Submitted|Draft/);
      const add = page.getByRole("link", { name: "Add credential" });
      await expect(add).toHaveAttribute("href", `${base}/my-credentials/new`);
      expect((await add.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expectNoPageOverflow(page);
      if (width === 375 || width === 1280) await expectNoA11yViolations(page);
      await qaScreenshot(page, "qaf2-my-credentials");
    }

    // The record: locked hierarchy, readable dates, worker-visible data only.
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(`${base}/my-credentials`);
    await page
      .getByRole("list", { name: "My credentials" })
      .getByRole("link", { name: /Basic Life Support/ })
      .click();
    await expect(page).toHaveURL(/\/my-credentials\/[0-9a-f-]{36}$/);
    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toContainText("Basic Life Support");
    await expect(title).toHaveCSS("font-weight", "700");
    await expect(
      page.getByRole("main").getByRole("link", { name: "My Credentials" }),
    ).toBeVisible();
    await expect(nav.getByRole("link", { name: "Credentials" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // P0-E9-3C worker-mobile record: state and expiry first, then the worker's sections.
    await expect(page.getByRole("main").locator("header")).toContainText("Verified");
    await expect(page.getByRole("main").locator("header")).toContainText(
      /Expires [A-Z][a-z]{2} \d{1,2}, \d{4}/,
    );
    for (const name of [
      "Evidence",
      `Sharing with ${world.agencyName}`,
      `Review by ${world.agencyName}`,
      "Renew",
      "Withdraw",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name })).toHaveCSS("font-size", "20px");
    }
    await expect(page.getByRole("region", { name: "Evidence" })).toContainText("Document ready");
    await expect(page.getByRole("region", { name: `Review by ${world.agencyName}` })).toContainText(
      "Verified",
    );
    // History stays available but secondary (collapsed).
    const versions = page.getByRole("list", { name: "Credential versions" });
    await expect(versions).toBeHidden();
    await page.getByText("History", { exact: false }).first().click();
    await expect(versions).toContainText(/Expires [A-Z][a-z]{2} \d{1,2}, \d{4}/);
    await expect(page.getByRole("main")).not.toContainText(iso);
    // Existing actions are preserved and touch-sized on phones.
    for (const name of ["Stop sharing", "Withdraw credential", "Open document for version 1"]) {
      const button = page.getByRole("button", { name });
      await expect(button).toBeVisible();
      expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    for (const button of await page.getByRole("button", { name: /^Open document / }).all()) {
      expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    // No agency-side review controls or internal compliance data.
    await expect(page.getByRole("button", { name: "Record decision" })).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText(/reviewer|internal|storage|bucket/i);
    await expectNoPageOverflow(page);
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "qaf2-my-credential-record");
    const recordPath = new URL(page.url()).pathname;
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(recordPath);
    await expectNoPageOverflow(page);
    await expectNoA11yViolations(page);
    await page.context().close();

    // Role isolation: staff and facility users never get the worker's self-service data.
    for (const who of [world.scheduler, world.facilityAdmin]) {
      const other = await signedIn(browser, who.email);
      expect((await other.goto(`${base}/my-credentials`))?.status()).toBe(404);
      expect((await other.goto(recordPath))?.status()).toBe(404);
      await other.goto(`${base}/timesheets`);
      await expect(other.getByRole("list", { name: "My timesheets" })).toHaveCount(0);
      await expect(other.getByRole("navigation", { name: "Worker" })).toHaveCount(0);
      await other.context().close();
    }
  });

  test("responsive: a centred self-service column at 375 / 768 / desktop, never the sidebar", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.wendy.email);
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organisations/${world.agencyId}/my-shifts`);
      await expect(page.getByRole("navigation", { name: "Worker" })).toBeVisible();
      await expect(page.getByRole("complementary", { name: "Workspace sidebar" })).toHaveCount(0);
      await expectNoPageOverflow(page);
      const column = await page
        .getByRole("main")
        .locator(":scope > div")
        .evaluate((node) => node.getBoundingClientRect().width);
      expect(column).toBeLessThanOrEqual(576 + 1);
    }
    await page.context().close();
  });
});
