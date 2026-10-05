import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import { createStaffingWorld, isoDay, type StaffingWorld } from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn } from "./support";

/*
 * P0-E8-S8 final responsive / accessibility / brand sweep. Representative
 * routes in every frame at 375, 412, 768, 1024 and 1280 px: no page-level
 * horizontal overflow at any width, axe at the narrowest and widest, and the
 * final QA screenshot set (QA_SCREENSHOTS_DIR).
 */

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const WIDTHS = [375, 412, 768, 1024, 1280];

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  return page;
}

async function sweep(page: Page, path: string, name: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoPageOverflow(page);
    await qaScreenshot(page, `s8-${name}`);
    if (width === 375 || width === 1280) {
      const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
      expect(results.violations, `${name} @ ${width}px`).toEqual([]);
    }
  }
}

test.describe.serial("final responsive, accessibility and brand sweep", () => {
  test.setTimeout(300_000);

  let world: StaffingWorld;
  let shiftId: string;
  let wendyWorkerId: string;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`s8-${testInfo.project.name.split("-")[0] ?? "e2e"}`);
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
    // S9A.1 QA density: more real upcoming work through the public API — a
    // filled shift, a larger unfilled one and two facility staffing requests.
    const locationId = locations.data[0]?.id ?? "";
    const more = async (day: number, start: string, end: string, headcount: number) => {
      const result = await world.scheduler.client.rpc("create_shift", {
        p_agency_facility_id: world.facilityId,
        p_facility_location_id: locationId,
        p_discipline_key: "cna",
        p_shift_date: isoDay(day),
        p_start_time: start,
        p_end_time: end,
        p_requested_headcount: headcount,
        p_open: true,
      });
      if (result.error) throw result.error;
      return result.data;
    };
    const filledShift = await more(5, "19:00", "07:00", 1);
    await more(7, "07:00", "15:00", 3);
    for (const [day, start, end] of [
      [4, "15:00", "23:00"],
      [6, "07:00", "15:00"],
    ] as const) {
      const request = await world.facilityAdmin.client.rpc("submit_facility_shift_request", {
        p_relationship_id: world.relationshipId,
        p_facility_location_id: locationId,
        p_discipline_key: "cna",
        p_shift_date: isoDay(day),
        p_start_time: start,
        p_end_time: end,
        p_requested_headcount: 2,
      });
      if (request.error) throw request.error;
    }
    const worker = await world.wendy.client
      .from("agency_workers")
      .select("id")
      .eq("agency_organisation_id", world.agencyId);
    if (worker.error) throw worker.error;
    wendyWorkerId = worker.data[0]?.id ?? "";
    const assigned = await world.scheduler.client.rpc("assign_worker_to_shift", {
      p_shift_id: filledShift,
      p_agency_worker_id: wendyWorkerId,
    });
    if (assigned.error) throw assigned.error;
  });

  test("agency and finance frames", async ({ browser }) => {
    const page = await signedIn(browser, world.admin.email);
    const base = `/app/organisations/${world.agencyId}`;
    for (const [path, name] of [
      [base, "agency-overview"],
      [`${base}/shifts`, "agency-shifts"],
      [`${base}/shifts/${shiftId}`, "agency-shift-record"],
      [`${base}/workforce`, "agency-workforce"],
      [`${base}/workforce/${wendyWorkerId}`, "agency-worker-record"],
      [`${base}/facilities`, "agency-facilities"],
      [`${base}/facilities/${world.facilityId}`, "agency-facility-record"],
      [`${base}/attendance`, "agency-attendance"],
      [`${base}/timesheets`, "agency-timesheets"],
      [`${base}/compliance`, "agency-compliance"],
      [`${base}/operations`, "agency-operations"],
      [`${base}/rates`, "finance-rates"],
      [`${base}/pricing`, "finance-pricing"],
      [`${base}/payroll`, "finance-payroll"],
      [`${base}/invoices`, "finance-invoices"],
    ] as const) {
      await sweep(page, path, name);
    }
    // S9A.1: the Shifts details drawer open (modal), desktop and phone.
    await page.goto(`${base}/shifts`);
    for (const width of [1280, 412]) {
      await page.setViewportSize({ width, height: 900 });
      await page
        .getByRole("region", { name: "Shifts table" })
        .getByRole("button", { name: /^Details for / })
        .first()
        .click();
      const drawer = page.getByRole("dialog", { name: "Shift Details" });
      await expect(drawer).toBeVisible();
      await qaScreenshot(page, "s9a1-shifts-drawer-open");
      const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
      expect(results.violations, `shifts drawer @ ${width}px`).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
    }
    await page.context().close();
  });

  test("facility frame", async ({ browser }) => {
    const page = await signedIn(browser, world.facilityAdmin.email);
    const base = `/app/organisations/${world.facilityOrgId}`;
    for (const [path, name] of [
      [base, "facility-overview"],
      [`${base}/staffing-requests`, "facility-requests"],
      [`${base}/staffing-requests/${shiftId}`, "facility-request-detail"],
      [`${base}/timesheets`, "facility-signoff"],
    ] as const) {
      await sweep(page, path, name);
    }
    await page.context().close();
  });

  test("worker frame", async ({ browser }) => {
    const page = await signedIn(browser, world.wendy.email);
    const base = `/app/organisations/${world.agencyId}`;
    for (const [path, name] of [
      [base, "worker-home"],
      [`${base}/my-shifts`, "worker-my-shifts"],
      [`${base}/timesheets`, "worker-timesheets"],
      [`${base}/my-credentials`, "worker-credentials"],
    ] as const) {
      await sweep(page, path, name);
    }
    // The bottom navigation never covers the last control on the page.
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto(`${base}/my-credentials`);
    await page.keyboard.press("End");
    const nav = await page.getByRole("navigation", { name: "Worker" }).boundingBox();
    const lastButton = page.getByRole("main").getByRole("button").last();
    await lastButton.scrollIntoViewIfNeeded();
    const box = await lastButton.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(nav?.y ?? Infinity);
    await page.context().close();
  });

  test("personal and auth frames", async ({ browser, page }) => {
    for (const [path, name] of [
      ["/sign-in", "auth-sign-in"],
      ["/sign-up", "auth-sign-up"],
      ["/forgot-password", "auth-forgot-password"],
      ["/reset-password", "auth-reset-password"],
      ["/invite", "auth-invite"],
      ["/auth/error", "auth-error"],
      ["/definitely-not-a-page", "system-not-found"],
    ] as const) {
      await sweep(page, path, name);
    }
    const signedInPage = await signedIn(browser, world.scheduler.email);
    for (const [path, name] of [
      ["/app", "personal-chooser"],
      ["/app/account", "personal-account"],
      ["/app/security", "personal-security"],
      ["/app/security/verify", "personal-mfa-verify"],
    ] as const) {
      await sweep(signedInPage, path, name);
    }
    await signedInPage.context().close();
  });
});
