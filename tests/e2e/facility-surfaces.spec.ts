import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import {
  createStaffingWorld,
  facilityMember,
  isoDay,
  type Person,
  type StaffingWorld,
} from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn, SIGNED_IN_LANDING } from "./support";

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
  await expect(page).toHaveURL(SIGNED_IN_LANDING);
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
    await expect(summary.getByRole("link", { name: /Open Requests/ })).toContainText(/[1-9]/);
    await expect(summary.getByRole("link", { name: /Timesheets to Sign Off/ })).toBeVisible();
    await expect(
      admin.getByRole("region", { name: "Today and upcoming" }).getByRole("link", {
        name: /Certified Nursing Assistant/,
      }),
    ).toHaveAttribute("href", `${base}/staffing-requests/${shiftId}`);
    await expect(admin.getByRole("main")).not.toContainText(NO_LEAKS);
    await qaScreenshot(admin, "s4-facility-overview");
    // P0-E8-S9H: member administration lives in Settings → Team & Permissions.
    await admin.goto(`${base}/settings/team`);
    await expect(admin.getByRole("region", { name: "Members table" })).toBeVisible();
    await expect(admin.getByRole("main")).not.toContainText(NO_LEAKS);
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
    const drawer = admin.getByRole("dialog", { name: "Request Details" });
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

  test("P0-E8-QA-F1: the facility workspace is on the locked visual system", async ({
    browser,
  }, testInfo) => {
    const mobile = testInfo.project.name.startsWith("mobile");
    const admin = await signedIn(browser, world.facilityAdmin.email);
    const base = `/app/organisations/${world.facilityOrgId}`;

    /** Locked reference header: one h1, Manrope 700 (31.5 px from sm), inside `.chelth-locked`. */
    async function expectLockedHeader() {
      const h1 = admin.getByRole("heading", { level: 1 });
      await expect(h1).toHaveCount(1);
      const style = await h1.evaluate((node) => {
        const computed = getComputedStyle(node);
        return {
          weight: computed.fontWeight,
          size: computed.fontSize,
          locked: Boolean(node.closest(".chelth-locked")),
        };
      });
      expect(style.weight).toBe("700");
      expect(style.locked).toBe(true);
      if (!mobile) expect(style.size).toBe("31.5px");
    }

    async function expectNoOverflowAt(widths: number[]) {
      const original = admin.viewportSize();
      for (const width of widths) {
        await admin.setViewportSize({ width, height: 860 });
        await expectNoPageOverflow(admin);
      }
      if (original) await admin.setViewportSize(original);
    }

    // Overview: locked header, KPI + panel family, the locked step-up note (same verify route).
    await admin.goto(base);
    await expectLockedHeader();
    await expect(admin.getByRole("region", { name: "Facility summary" })).toBeVisible();
    await expect(admin.getByRole("region", { name: "Today and upcoming" })).toBeVisible();
    await expect(admin.getByRole("region", { name: "Awaiting sign-off" })).toBeVisible();
    await expect(admin.getByRole("note").getByRole("link", { name: "Verify now" })).toHaveAttribute(
      "href",
      `/app/security/verify?next=${encodeURIComponent(base)}`,
    );
    await expect(admin.getByRole("main")).not.toContainText(NO_LEAKS);
    await expectNoOverflowAt([375, 412]);
    await expectNoA11yViolations(admin);

    // Sidebar: the concise "Sign-off" label is current on its page and never truncated.
    if (!mobile) {
      const signoff = admin
        .getByRole("navigation", { name: "Workspace" })
        .getByRole("link", { name: "Sign-off" });
      await expect(signoff).toBeVisible();
      const clipped = await signoff.evaluate((link) =>
        [link, ...link.querySelectorAll("*")].some(
          (node) => node.textContent?.trim() === "Sign-off" && node.scrollWidth > node.clientWidth,
        ),
      );
      expect(clipped).toBe(false);
    }

    // Staffing requests: locked filters, canonical CTA, REF table, profile drawer.
    await admin.goto(`${base}/staffing-requests`);
    await expectLockedHeader();
    const filters = admin.getByRole("form", { name: "Filter requests" });
    for (const name of ["Status", "When"]) {
      const box = await filters.getByRole("combobox", { name }).evaluate((node) => {
        const control = node.parentElement?.getBoundingClientRect();
        return control ? Math.round(control.height) : 0;
      });
      expect(box).toBeGreaterThanOrEqual(44);
    }
    await expect(admin.getByRole("link", { name: "New request" })).toHaveAttribute(
      "href",
      "#request-staff",
    );
    const table = admin.getByRole("region", { name: "Staffing requests table" });
    await expect(admin.getByRole("region", { name: "Requests and Shifts" })).toContainText(
      "Certified Nursing Assistant",
    );
    const trigger = table.getByRole("button", { name: /^Details for / }).first();
    await expect(trigger).toHaveText("⋮");
    await trigger.click();
    const drawer = admin.getByRole("dialog", { name: "Request Details" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("tab", { name: "Overview" })).toBeVisible();
    await expect(drawer.getByRole("tab", { name: "Staffing" })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Open request" })).toBeVisible();
    await expect(drawer).not.toContainText(NO_LEAKS);
    const panel = await drawer.evaluate((node) => {
      const box = (node.firstElementChild ?? node).getBoundingClientRect();
      return { width: Math.round(box.width), height: Math.round(box.height) };
    });
    const viewport = admin.viewportSize();
    if (mobile) {
      expect(panel.width).toBe(viewport?.width);
    } else {
      expect(panel.width).toBe(387);
    }
    await admin.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
    if (mobile) {
      // Wide tables scroll inside their labelled region, never the page.
      const scrolls = await table.evaluate((node) => node.scrollWidth > node.clientWidth);
      expect(scrolls).toBe(true);
    }
    await expectNoOverflowAt([375, 412]);
    await expectNoA11yViolations(admin);

    // Request record: canonical record arrangement with section tabs (no scrollbar chrome).
    await admin.goto(`${base}/staffing-requests/${shiftId}`);
    await expectLockedHeader();
    const sections = admin.getByRole("navigation", { name: "Request sections" });
    await expect(sections.getByRole("link")).toHaveText(["Details", "Who is coming"]);
    const chrome = await sections.evaluate((node) => {
      const computed = getComputedStyle(node);
      return { overflowY: computed.overflowY, scrollbar: computed.scrollbarWidth };
    });
    expect(chrome).toEqual({ overflowY: "hidden", scrollbar: "none" });
    await expect(admin.getByRole("region", { name: "Who is coming" })).toContainText(
      "No workers assigned yet.",
    );
    await expectNoOverflowAt([375, 412]);
    await expectNoA11yViolations(admin);

    // Timesheet sign-off: locked family, facility projection only.
    await admin.goto(`${base}/timesheets`);
    await expectLockedHeader();
    await expect(admin.getByRole("region", { name: "Entries for Sign-off" })).toContainText(
      "No entries awaiting sign-off.",
    );
    await expect(admin.getByRole("main")).not.toContainText(NO_LEAKS);
    await expectNoOverflowAt([375, 412]);
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
    await expect(summary.getByRole("link", { name: /Open Requests/ })).toBeVisible();
    await expect(summary.getByRole("link", { name: /Timesheets to Sign Off/ })).toHaveCount(0);
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
    await expect(summary.getByRole("link", { name: /Timesheets to Sign Off/ })).toBeVisible();
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
        "Sign-off",
        "Messages",
        "Settings",
      ]);
    }
    await page.context().close();
  });
});
