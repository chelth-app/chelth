import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import {
  createStaffingWorld,
  facilityMember,
  isoDay,
  type Person,
  type StaffingWorld,
} from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn } from "./support";

/*
 * P0-E8-S4 facility workspace: one shell for Facility Admin, Scheduler and
 * Supervisor; differences come only from capabilities. Proves facility-safe
 * data (no pay, finance, coordinates or agency-internal routes), capability-
 * driven actions, the request drawer, and accessibility at desktop and 412 px.
 */

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const NO_LEAKS = /\$|pay rate|bill rate|margin|payroll|invoice|latitude|longitude|40\.71/i;

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

test.describe.serial("facility workspace surfaces", () => {
  test.setTimeout(240_000);

  let world: StaffingWorld;
  let scheduler: Person;
  let supervisor: Person;
  let shiftId: string;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`s4-${testInfo.project.name.split("-")[0] ?? "e2e"}`);
    scheduler = await facilityMember(
      world,
      "e2e-s4-fac-scheduler",
      "Fay Scheduler",
      "facility.scheduler",
    );
    supervisor = await facilityMember(
      world,
      "e2e-s4-fac-supervisor",
      "Sid Supervisor",
      "facility.supervisor",
    );
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

  test("Facility Admin: overview, requests, drawer and record stay facility-safe", async ({
    browser,
  }) => {
    const admin = await signedIn(browser, world.facilityAdmin.email);
    const base = `/app/organisations/${world.facilityOrgId}`;

    // Overview (P2, facility scope).
    await admin.goto(base);
    const summary = admin.getByRole("region", { name: "Facility summary" });
    await expect(summary.getByRole("link", { name: /Open requests/ })).toContainText(/[1-9]/);
    await expect(summary.getByRole("link", { name: /Timesheets to sign off/ })).toBeVisible();
    await expect(
      admin.getByRole("region", { name: "Today and upcoming" }).getByRole("link", {
        name: /Certified Nursing Assistant/,
      }),
    ).toHaveAttribute("href", `${base}/staffing-requests/${shiftId}`);
    // Member administration stays (P6 card language).
    await expect(admin.getByRole("region", { name: "Members table" })).toBeVisible();
    await expect(admin.getByRole("main")).not.toContainText(NO_LEAKS);
    await qaScreenshot(admin, "s4-facility-overview");
    await admin.getByRole("heading", { name: "Members" }).scrollIntoViewIfNeeded();
    await qaScreenshot(admin, "s4-facility-members");
    await expectNoA11yViolations(admin);

    // Staffing requests (P3): quick filter, URL-backed filter, drawer.
    await admin.goto(`${base}/staffing-requests`);
    await expect(admin.getByRole("link", { name: "New request" })).toBeVisible();
    await admin
      .getByRole("region", { name: "Upcoming requests" })
      .getByRole("link", { name: /Open/ })
      .click();
    await expect(admin).toHaveURL(/status=open&when=upcoming/);
    await expect(
      admin.getByRole("region", { name: "Upcoming requests" }).getByRole("link", { name: /Open/ }),
    ).toHaveAttribute("aria-current", "true");
    await expect(
      admin.getByRole("form", { name: "Filter requests" }).getByRole("combobox", {
        name: "Status",
      }),
    ).toHaveValue("open");
    const table = admin.getByRole("region", { name: "Staffing requests table" });
    const row = table.getByRole("row", { name: /Certified Nursing Assistant/ }).first();
    await expect(row).toContainText("Unfilled · 0 of 2");
    await qaScreenshot(admin, "s4-staffing-requests");
    await expectNoA11yViolations(admin);

    const trigger = row.getByRole("button", { name: /^Details for / });
    await trigger.click();
    const drawer = admin.getByRole("dialog", { name: /Certified Nursing Assistant/ });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Close details" })).toBeFocused();
    expect(await drawer.evaluate((node) => node.matches(":modal"))).toBe(true);
    await expect(drawer).toContainText("Mercy Main");
    await expect(drawer).not.toContainText(NO_LEAKS);
    await qaScreenshot(admin, "s4-staffing-request-drawer-open");
    await expectNoA11yViolations(admin);
    await admin.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();

    // The record route stays authoritative.
    await trigger.click();
    await drawer.getByRole("link", { name: "Open request" }).click();
    await expect(admin).toHaveURL(new RegExp(`/staffing-requests/${shiftId}$`));
    await expect(admin.getByRole("heading", { level: 1 })).toContainText(
      "Certified Nursing Assistant",
    );
    await expect(admin.getByRole("region", { name: "Who is coming" })).toContainText(
      "No workers assigned yet.",
    );
    await expect(admin.getByRole("main")).not.toContainText(NO_LEAKS);
    await qaScreenshot(admin, "s4-staffing-request-detail");
    await expectNoA11yViolations(admin);

    // Timesheet sign-off surface (empty here; sign-off itself is covered by timesheets.spec).
    await admin.goto(`${base}/timesheets`);
    await expect(admin.getByRole("heading", { level: 1, name: "Timesheets" })).toBeVisible();
    await expect(admin.getByText("No entries awaiting sign-off.")).toBeVisible();
    await qaScreenshot(admin, "s4-timesheet-signoff");
    await expectNoA11yViolations(admin);
    await admin.context().close();
  });

  test("Facility Scheduler: requests only — no sign-off, no member administration", async ({
    browser,
  }) => {
    const page = await signedIn(browser, scheduler.email);
    const base = `/app/organisations/${world.facilityOrgId}`;
    await page.goto(base);
    const summary = page.getByRole("region", { name: "Facility summary" });
    await expect(summary.getByRole("link", { name: /Open requests/ })).toBeVisible();
    await expect(summary.getByRole("link", { name: /Timesheets to sign off/ })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Awaiting sign-off" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create invitation" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Invitations" })).toHaveCount(0);

    await page.goto(`${base}/staffing-requests`);
    await expect(page.getByRole("link", { name: "New request" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Request staff" })).toBeVisible();
    expect((await page.goto(`${base}/timesheets`))?.status()).toBe(404);
    await page.context().close();
  });

  test("Facility Supervisor: view and sign-off only — no request creation, no admin", async ({
    browser,
  }) => {
    const page = await signedIn(browser, supervisor.email);
    const base = `/app/organisations/${world.facilityOrgId}`;
    await page.goto(base);
    const summary = page.getByRole("region", { name: "Facility summary" });
    await expect(summary.getByRole("link", { name: /Timesheets to sign off/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create invitation" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Invitations" })).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText(NO_LEAKS);
    await qaScreenshot(page, "s4-supervisor-overview");
    await expectNoA11yViolations(page);

    await page.goto(`${base}/staffing-requests`);
    await expect(page.getByRole("link", { name: "New request" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Request staff" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Submit request" })).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Staffing requests table" }).getByRole("row", {
        name: /Certified Nursing Assistant/,
      }),
    ).toHaveCount(1);
    await qaScreenshot(page, "s4-supervisor-requests");
    await expectNoA11yViolations(page);

    // The request record: no withdraw / request actions for a viewer.
    await page.goto(`${base}/staffing-requests/${shiftId}`);
    await expect(page.getByRole("button", { name: "Withdraw request" })).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText(NO_LEAKS);
    await page.context().close();
  });

  test("facility users never reach agency-only routes", async ({ browser }) => {
    const page = await signedIn(browser, world.facilityAdmin.email);
    for (const path of ["shifts", "workforce", "attendance", "operations", "payroll", "pricing"]) {
      for (const organisationId of [world.agencyId, world.facilityOrgId]) {
        const response = await page.goto(`/app/organisations/${organisationId}/${path}`);
        expect(response?.status(), `${organisationId}/${path}`).toBe(404);
      }
    }
    await page.goto(`/app/organisations/${world.facilityOrgId}`);
    const nav = page.getByRole("navigation", { name: "Workspace" });
    if (await nav.isVisible()) {
      await expect(nav.getByRole("link")).toHaveText([
        "Overview",
        "Staffing requests",
        "Timesheet sign-off",
      ]);
    }
    await page.context().close();
  });
});
