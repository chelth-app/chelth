import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import {
  createStaffingWorld,
  facilityMember,
  isoDay,
  type StaffingWorld,
} from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn } from "./support";

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
  await expect(page).toHaveURL(/\/app$/, AFTER_ACTION);
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

  test("My shifts: accept, shift details drawer, upcoming / past tabs", async ({ browser }) => {
    const page = await signedIn(browser, world.wendy.email);
    await page.goto(`/app/organisations/${world.agencyId}/my-shifts`);
    const tabs = page.getByRole("navigation", { name: "Assignment period" });
    await expect(tabs.getByRole("link", { name: "Upcoming" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const assignments = page.getByRole("list", { name: "My assignments" });
    await expect(assignments).toContainText("Mercy Rehab");
    await qaScreenshot(page, "s6-my-shifts");
    await expectNoA11yViolations(page);

    await page.getByRole("button", { name: "Accept shift at Mercy Rehab" }).click();
    await expect(assignments).toContainText("Accepted", AFTER_ACTION);

    const details = assignments.getByRole("button", { name: /^Shift details: Mercy Rehab/ });
    await details.click();
    const drawer = page.getByRole("dialog", { name: "Mercy Rehab" });
    await expect(drawer.getByRole("button", { name: "Close details" })).toBeFocused();
    await expect(drawer).toContainText("Certified Nursing Assistant");
    await expect(drawer).toContainText("Accepted");
    // Own data only: no other workers, no pay or bill values.
    await expect(drawer).not.toContainText(/Nina|Wes|\$/);
    await qaScreenshot(page, "s6-shift-detail");
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(details).toBeFocused();

    await tabs.getByRole("link", { name: "Past" }).click();
    await expect(page).toHaveURL(/view=past/);
    await expect(page.getByText("No past assignments.")).toBeVisible();
    await page.context().close();
  });

  test("attendance: clock in, break, clock out, correction entry — without location prompts", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.extra.wes?.email ?? "");
    await page.goto(`/app/organisations/${world.agencyId}/my-shifts`);
    const card = page.getByRole("list", { name: "My attendance" }).getByRole("listitem").first();
    await expect(card).toContainText("Not started");

    // This site does not check location: no explanation, no browser prompt.
    await page.getByRole("button", { name: "Clock in at Mercy Rehab" }).click();
    await expect(page.getByRole("region", { name: "Location check" })).toHaveCount(0);
    await expect(card).toContainText(/Clocked in|Needs review/, AFTER_ACTION);
    await qaScreenshot(page, "s6-clocked-in");

    await page.getByRole("button", { name: "Start break at Mercy Rehab" }).click();
    await expect(card).toContainText("You are on a break", AFTER_ACTION);
    await expect(page.getByRole("button", { name: "Clock out at Mercy Rehab" })).toHaveCount(0);
    await qaScreenshot(page, "s6-break-active");
    await expectNoA11yViolations(page);
    await page.getByRole("button", { name: "End break at Mercy Rehab" }).click();

    // Clock-out is available again once the break ends.
    const clockOut = page.getByRole("button", { name: "Clock out at Mercy Rehab" });
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
    await expect(page.getByRole("heading", { name: "Add a credential", level: 2 })).toBeVisible();
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
