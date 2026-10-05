import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";

import {
  agencyMember,
  createStaffingWorld,
  isoDay,
  type Person,
  type StaffingWorld,
} from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn } from "./support";

/*
 * P0-E8-S3 agency operational surfaces: Operations Overview (P2), Shifts,
 * Workforce, Worker record, Facilities, Timesheets, Compliance. Proves the
 * composed pages keep working: capability-gated panels, URL-backed filters,
 * accessible drawers, in-page sections that only point at real content, and
 * no invented capabilities.
 */

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
  expect(results.violations).toEqual([]);
  await expectNoPageOverflow(page);
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app$/);
  return page;
}

/** No reference-only features that Chelth does not have. */
async function expectNoInventedFeatures(page: Page) {
  const main = page.getByRole("main");
  await expect(main).not.toContainText(/forecast|revenue|utili[sz]ation|score|rating|trend/i);
  await expect(main.getByRole("button", { name: /message|rate worker|availability/i })).toHaveCount(
    0,
  );
  await expect(main.getByRole("link", { name: /message|reports?$|availability/i })).toHaveCount(0);
}

/** Every in-page section link points at an element that exists (no dead tabs). */
async function expectSectionLinksResolve(nav: Locator, page: Page) {
  const hrefs = await nav
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    expect(href.startsWith("#"), href).toBe(true);
    await expect(page.locator(href), href).toHaveCount(1);
  }
  return hrefs;
}

/** Opens a drawer from its row trigger and checks focus, Escape and focus return. */
async function expectDrawerRoundTrip(page: Page, trigger: Locator, dialogName: string | RegExp) {
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: dialogName });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Close details" })).toBeFocused();
  expect(await drawer.evaluate((node) => node.matches(":modal"))).toBe(true);
  return drawer;
}

test.describe.serial("agency operational surfaces", () => {
  test.setTimeout(240_000);

  let world: StaffingWorld;
  let finance: Person;
  let shiftId: string;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`s3-${testInfo.project.name.split("-")[0] ?? "e2e"}`);
    finance = await agencyMember(world, "e2e-s3-finance", "Fin Finance", "agency.finance");
    const locations = await world.admin.client
      .from("facility_locations")
      .select("id")
      .eq("agency_facility_id", world.facilityId);
    if (locations.error) throw locations.error;
    const created = await world.scheduler.client.rpc("create_shift", {
      p_agency_facility_id: world.facilityId,
      p_facility_location_id: locations.data[0]?.id ?? "",
      p_discipline_key: "cna",
      p_shift_date: isoDay(3),
      p_start_time: "07:00",
      p_end_time: "15:00",
      p_requested_headcount: 2,
      p_open: true,
    });
    if (created.error) throw created.error;
    shiftId = created.data;
  });

  test("Operations Overview: real, capability-gated signals only", async ({ browser }) => {
    const admin = await signedIn(browser, world.admin.email);
    await admin.goto(`/app/organisations/${world.agencyId}`);
    const summary = admin.getByRole("region", { name: "Operations summary" });
    await expect(summary.getByRole("link", { name: /Open Shifts/ })).toContainText(/[1-9]/);
    // Locked P2 KPI slots, each a real count: open, pending confirmations, issues, requests.
    await expect(summary.getByRole("link", { name: /Pending Confirmations/ })).toBeVisible();
    await expect(summary.getByRole("link", { name: /Facility Requests/ })).toBeVisible();
    await expect(summary.getByRole("link", { name: /Open Shifts/ })).toHaveAttribute(
      "href",
      new RegExp(
        `/app/organisations/${world.agencyId}/shifts\\?status=open&from=\\d{4}-\\d{2}-\\d{2}$`,
      ),
    );
    await expect(
      admin.getByRole("region", { name: "Staffing Requests", exact: true }),
    ).toBeVisible();
    await expect(admin.getByRole("list", { name: "Upcoming shifts by staffing" })).toContainText(
      "Unfilled",
    );
    await expect(admin.getByRole("list", { name: "Workers by status" })).toContainText("Active");
    // Administration stays on the Overview.
    await expect(admin.getByRole("heading", { name: "Members" })).toBeVisible();
    await expectNoInventedFeatures(admin);
    await qaScreenshot(admin, "s3-operations-overview");
    await expectNoA11yViolations(admin);
    await admin.context().close();

    // Finance: no shift, attendance or workforce signals it cannot open.
    const fin = await signedIn(browser, finance.email);
    await fin.goto(`/app/organisations/${world.agencyId}`);
    const finSummary = fin.getByRole("region", { name: "Operations summary" });
    await expect(finSummary.getByRole("link", { name: /Timesheets to Approve/ })).toBeVisible();
    await expect(finSummary.getByRole("link", { name: /Open Shifts/ })).toHaveCount(0);
    await expect(fin.getByRole("region", { name: "Today's schedule" })).toHaveCount(0);
    await expect(fin.getByRole("region", { name: "Staffing requests" })).toHaveCount(0);
    await expect(fin.getByRole("region", { name: "Shift Coverage" })).toHaveCount(0);
    await expect(fin.getByRole("region", { name: "Coverage Outlook" })).toHaveCount(0);
    await expect(fin.getByRole("region", { name: "Workforce" })).toHaveCount(0);
    await fin.context().close();
  });

  test("Shifts: quick filters keep URL state; drawer inspects without replacing the route", async ({
    browser,
  }) => {
    const scheduler = await signedIn(browser, world.scheduler.email);
    await scheduler.goto(`/app/organisations/${world.agencyId}/shifts`);
    const open = scheduler
      .getByRole("region", { name: "Upcoming shifts" })
      .getByRole("link", { name: /Open/ });
    await open.click();
    await expect(scheduler).toHaveURL(/status=open&from=\d{4}-\d{2}-\d{2}/);
    await expect(
      scheduler
        .getByRole("region", { name: "Upcoming shifts" })
        .getByRole("link", { name: /Open/ }),
    ).toHaveAttribute("aria-current", "true");
    const filters = scheduler.getByRole("form", { name: "Filter shifts" });
    await expect(filters.getByRole("combobox", { name: "Status" })).toHaveValue("open");

    const table = scheduler.getByRole("region", { name: "Shifts table" });
    const row = table.getByRole("row", { name: /Mercy Rehab/ }).first();
    await expect(row).toContainText("Open");
    await qaScreenshot(scheduler, "s3-shifts");
    await expectNoA11yViolations(scheduler);

    const trigger = row.getByRole("button", { name: /^Details for Mercy Rehab/ });
    const drawer = await expectDrawerRoundTrip(scheduler, trigger, "Shift Details");
    await expect(drawer).toContainText("Mercy Rehab");
    await expect(drawer).toContainText("Certified Nursing Assistant (CNA)");
    await expect(drawer).toContainText("0 of 2");
    await qaScreenshot(scheduler, "s3-shifts-drawer-open");
    await expectNoA11yViolations(scheduler);
    await scheduler.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await drawer.getByRole("link", { name: "Open shift" }).click();
    await expect(scheduler).toHaveURL(new RegExp(`/shifts/${shiftId}$`));

    // Shift record: in-page sections point at real content only.
    await expect(scheduler.getByRole("heading", { level: 1 })).toContainText("Mercy Rehab");
    const sections = await expectSectionLinksResolve(
      scheduler.getByRole("navigation", { name: "Shift sections" }),
      scheduler,
    );
    expect(sections).toContain("#shift-details-heading");
    await expect(scheduler.getByText("7:00 AM – 3:00 PM")).toBeVisible();
    await expectNoA11yViolations(scheduler);

    // Clearing filters returns to the unfiltered list.
    await scheduler.goto(`/app/organisations/${world.agencyId}/shifts?status=open`);
    await scheduler
      .getByRole("form", { name: "Filter shifts" })
      .getByRole("link", { name: "Clear filters" })
      .click();
    await expect(scheduler).toHaveURL(new RegExp(`/organisations/${world.agencyId}/shifts$`));
    await scheduler.context().close();
  });

  test("Workforce and worker record: filters, drawer, real sections, no invented actions", async ({
    browser,
  }) => {
    const admin = await signedIn(browser, world.admin.email);
    await admin.goto(`/app/organisations/${world.agencyId}/workforce`);
    const byStatus = admin.getByRole("region", { name: "Workers by status" });
    await byStatus.getByRole("link", { name: /Active/ }).click();
    await expect(admin).toHaveURL(/status=active/);
    const table = admin.getByRole("region", { name: "Workers table" });
    await expect(table.getByRole("link", { name: "Wendy Ready" })).toBeVisible();
    await expectNoInventedFeatures(admin);
    await qaScreenshot(admin, "s3-workforce");
    await expectNoA11yViolations(admin);

    const trigger = table.getByRole("button", { name: "Details for Wendy Ready" });
    const drawer = await expectDrawerRoundTrip(admin, trigger, "Professional Details");
    await expect(drawer).toContainText("Wendy Ready");
    await expect(drawer.getByRole("link", { name: "Open worker record" })).toBeVisible();
    await qaScreenshot(admin, "s3-workforce-drawer-open");
    await expectNoA11yViolations(admin);
    await admin.keyboard.press("Escape");
    await expect(trigger).toBeFocused();

    // The status filter form keeps native GET behaviour.
    const filters = admin.getByRole("form", { name: "Filter workers" });
    await filters.getByRole("combobox", { name: "Status" }).selectOption("suspended");
    await filters.getByRole("button", { name: "Apply filters" }).click();
    await expect(admin).toHaveURL(/status=suspended/);
    await expect(admin.getByText("No workers with this status.")).toBeVisible();

    await admin.goto(`/app/organisations/${world.agencyId}/workforce`);
    await admin.getByRole("link", { name: "Wendy Ready" }).click();
    await expect(admin.getByRole("heading", { level: 1, name: "Wendy Ready" })).toBeVisible();
    const sections = await expectSectionLinksResolve(
      admin.getByRole("navigation", { name: "Worker record sections" }),
      admin,
    );
    // Only sections the product renders: no assignments/availability/skills tabs.
    expect(sections).not.toEqual(expect.arrayContaining(["#assignments-heading"]));
    await expectNoInventedFeatures(admin);
    await qaScreenshot(admin, "s3-worker-record");
    await expectNoA11yViolations(admin);
    await admin.context().close();
  });

  test("Facilities: drawer and facility record sections", async ({ browser }) => {
    const admin = await signedIn(browser, world.admin.email);
    await admin.goto(`/app/organisations/${world.agencyId}/facilities`);
    const table = admin.getByRole("region", { name: "Client facilities table" });
    await expect(table.getByRole("link", { name: "Mercy Rehab" })).toBeVisible();
    await qaScreenshot(admin, "s3-facilities");
    await expectNoA11yViolations(admin);

    const trigger = table.getByRole("button", { name: "Details for Mercy Rehab" });
    const drawer = await expectDrawerRoundTrip(admin, trigger, "Mercy Rehab");
    await expect(drawer).toContainText("Linked to a CHELTH facility organisation");
    await qaScreenshot(admin, "s3-facility-drawer-open");
    await expectNoA11yViolations(admin);
    await admin.keyboard.press("Escape");
    await expect(trigger).toBeFocused();

    await table.getByRole("link", { name: "Mercy Rehab" }).click();
    await expect(admin.getByRole("heading", { level: 1, name: "Mercy Rehab" })).toBeVisible();
    await expectSectionLinksResolve(
      admin.getByRole("navigation", { name: "Facility sections" }),
      admin,
    );
    await expect(
      admin.getByRole("listitem").filter({ hasText: "Mercy Main" }).first(),
    ).toBeVisible();
    await expectNoA11yViolations(admin);
    await admin.context().close();
  });

  test("Attendance, Timesheets and Compliance keep their workflows on the shared language", async ({
    browser,
  }) => {
    const admin = await signedIn(browser, world.admin.email);
    await admin.goto(`/app/organisations/${world.agencyId}/attendance`);
    await expect(admin.getByRole("heading", { level: 1, name: "Attendance" })).toBeVisible();
    await expect(admin.getByRole("region", { name: "Correction requests" })).toBeVisible();
    await expect(admin.getByRole("region", { name: "Open exceptions" })).toBeVisible();
    await qaScreenshot(admin, "s3-attendance");
    await expectNoA11yViolations(admin);

    await admin.goto(`/app/organisations/${world.agencyId}/timesheets`);
    const quick = admin.getByRole("region", { name: "Timesheets by status" });
    await quick.getByRole("link", { name: /To approve/ }).click();
    await expect(admin).toHaveURL(/status=submitted/);
    await expect(
      admin.getByRole("form", { name: "Filter timesheets" }).getByRole("combobox", {
        name: "Status",
      }),
    ).toHaveValue("submitted");
    await expect(
      admin.getByRole("region", { name: "Timesheets by status" }).getByRole("link", {
        name: /To approve/,
      }),
    ).toHaveAttribute("aria-current", "true");
    await qaScreenshot(admin, "s3-timesheets");
    await expectNoA11yViolations(admin);

    await admin.goto(`/app/organisations/${world.agencyId}/compliance`);
    await expect(
      admin.getByRole("heading", { level: 1, name: "Credential requirements" }),
    ).toBeVisible();
    await expect(admin.getByRole("list", { name: "Agency baseline requirements" })).toContainText(
      "Basic Life Support",
    );
    await qaScreenshot(admin, "s3-compliance");
    await expectNoA11yViolations(admin);
    await admin.context().close();
  });

  test("capability restrictions still hold on the restyled routes", async ({ browser }) => {
    const fin = await signedIn(browser, finance.email);
    for (const path of ["shifts", "workforce", "attendance", "compliance", "operations"]) {
      const response = await fin.goto(`/app/organisations/${world.agencyId}/${path}`);
      expect(response?.status(), path).toBe(404);
    }
    await fin.context().close();
  });
});
