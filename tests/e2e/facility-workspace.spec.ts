import AxeBuilder from "@axe-core/playwright";
import {
  type Browser,
  expect,
  type Locator,
  type Page,
  test,
  type TestInfo,
} from "@playwright/test";

import {
  arrangePastWork,
  createStaffingWorld,
  facilityMember,
  isoDay,
  type Person,
  type StaffingWorld,
} from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn, SIGNED_IN_LANDING } from "./support";

/*
 * P0-E9-3K: the facility workspace. Facility-only users land on their
 * facility, see a facility navigation (requests, coverage, attendance,
 * shared compliance, sign-off, messages) by capability, never agency or
 * finance data, and never another facility's.
 */

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const AFTER_ACTION = { timeout: 20_000 };
const NO_LEAKS =
  /\$|£|pay rate|bill rate|margin|payroll|invoice|latitude|longitude|40\.71|@e2e|\+1 ?\(/i;
const isMobile = (testInfo: TestInfo) => testInfo.project.name.startsWith("mobile");

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

async function navLabels(page: Page, testInfo: TestInfo): Promise<string[]> {
  let nav: Locator;
  if (isMobile(testInfo)) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    nav = page
      .getByRole("dialog", { name: "Workspace navigation" })
      .getByRole("navigation", { name: "Workspace" });
  } else {
    nav = page.getByRole("navigation", { name: "Workspace" });
  }
  await expect(nav).toBeVisible();
  const labels = (await nav.getByRole("link").allInnerTexts()).map((text) => text.trim());
  if (isMobile(testInfo)) await page.keyboard.press("Escape");
  return labels;
}

async function expectNotFound(page: Page, paths: string[]) {
  for (const path of paths) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
}

test.describe.serial("Facility workspace (P0-E9-3K)", () => {
  test.setTimeout(300_000);
  let world: StaffingWorld;
  let other: StaffingWorld;
  let scheduler: Person;
  let supervisor: Person;
  let base: string;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(300_000);
    const tag = `e93k-${testInfo.project.name.split("-")[0] ?? "e2e"}`;
    [world, other] = await Promise.all([
      createStaffingWorld(tag, [{ key: "ella", name: "Ella Onshift", blsExpiryDays: 400 }]),
      createStaffingWorld(`${tag}-b`),
    ]);
    base = `/app/organisations/${world.facilityOrgId}`;
    // Sequential: the first invite steps the facility admin up (one TOTP enrolment).
    scheduler = await facilityMember(
      world,
      "e2e-3k-fac-scheduler",
      "Fay Scheduler",
      "facility.scheduler",
    );
    supervisor = await facilityMember(
      world,
      "e2e-3k-fac-supervisor",
      "Sid Supervisor",
      "facility.supervisor",
    );

    // Ella is on shift at Mercy right now and has checked in.
    const locations = await world.admin.client
      .from("facility_locations")
      .select("id")
      .eq("agency_facility_id", world.facilityId);
    if (locations.error) throw locations.error;
    const ella = world.extra.ella;
    if (!ella) throw new Error("extra worker missing");
    await arrangePastWork(world, {
      worker: ella,
      facilityId: world.facilityId,
      locationId: locations.data[0]?.id ?? "",
      startAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      endAt: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
      events: [{ type: "clock_in", at: new Date(Date.now() - 55 * 60_000).toISOString() }],
    });

    // The agency shares Wendy's compliance with the facility relationship.
    const wendy = await world.wendy.client
      .from("agency_workers")
      .select("id")
      .eq("agency_organisation_id", world.agencyId)
      .single();
    if (wendy.error) throw wendy.error;
    const shared = await world.admin.client.rpc("share_worker_compliance", {
      p_relationship_id: world.relationshipId,
      p_agency_worker_id: wendy.data.id,
    });
    if (shared.error) throw shared.error;
  });

  test("Facility Admin: lands on the facility, requests staff, sees coverage, attendance and compliance", async ({
    browser,
  }, testInfo) => {
    const page = await signedIn(browser, world.facilityAdmin.email);
    // A facility-only account opens its facility directly (no chooser, no agency creation).
    await page.goto("/app");
    await expect(page).toHaveURL(new RegExp(`${base}$`), AFTER_ACTION);
    await expect(
      page.getByRole("heading", { level: 1, name: world.facilityOrgName }),
    ).toBeVisible();
    await expect(page.getByText("Create your staffing agency")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "All organizations" })).toHaveCount(0);
    expect(await navLabels(page, testInfo)).toEqual([
      "Overview",
      "Staffing requests",
      "Coverage",
      "Attendance",
      "Compliance",
      "Sign-off",
      "Messages",
      "Settings",
    ]);
    const today = page.getByRole("region", { name: "Today at your facility" });
    await expect(today).toContainText("Checked In Now");
    await expect(today).toContainText("Compliance Attention");
    await expect(today).toContainText("Unread Messages");
    await expect(page.getByRole("main")).not.toContainText(NO_LEAKS);
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "e9-3k-facility-overview");

    // Request staff → the existing request form.
    await page.getByRole("link", { name: "Request staff" }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/staffing-requests#request-staff$`));
    await page
      .getByRole("combobox", { name: "Location" })
      .selectOption({ label: "Mercy Main (America/New_York)" });
    await page
      .getByRole("combobox", { name: "Discipline" })
      .selectOption({ label: "Certified Nursing Assistant (CNA)" });
    await page.getByLabel("Shift date").fill(isoDay(4));
    await page.getByLabel("Start time").fill("07:00");
    await page.getByLabel("End time").fill("15:00");
    await page.getByRole("button", { name: "Submit request" }).click();
    await expect(page.getByText("Requested", { exact: true })).toBeVisible(AFTER_ACTION);
    const requestId = new URL(page.url()).pathname.split("/").pop() ?? "";

    // The agency opens it and assigns Wendy; she accepts (API: agency + worker side).
    const opened = await world.scheduler.client.rpc("open_shift", {
      p_shift_id: requestId,
    });
    if (opened.error) throw opened.error;
    const wendyWorker = await world.wendy.client
      .from("agency_workers")
      .select("id")
      .eq("agency_organisation_id", world.agencyId)
      .single();
    const assigned = await world.scheduler.client.rpc("assign_worker_to_shift", {
      p_shift_id: requestId,
      p_agency_worker_id: wendyWorker.data?.id ?? "",
    });
    if (assigned.error) throw assigned.error;
    const accepted = await world.wendy.client.rpc("accept_shift_assignment", {
      p_assignment_id: assigned.data[0]?.assignment_id ?? "",
    });
    if (accepted.error) throw accepted.error;

    // Coverage: the next 14 days show Wendy on the new request; today shows Ella.
    await page.goto(`${base}/coverage?view=upcoming`);
    const upcoming = page.getByRole("table", { name: "Coverage: Next 14 days" });
    await expect(upcoming.getByRole("row", { name: /Wendy Ready/ })).toContainText("Accepted");
    await expect(page.getByRole("main")).not.toContainText(NO_LEAKS);
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "e9-3k-facility-coverage");

    // Attendance: Ella is checked in (derived state only).
    await page.goto(`${base}/attendance`);
    await expect(page.getByRole("heading", { level: 1, name: "Attendance" })).toBeVisible();
    await expect(
      page
        .getByRole("table", { name: "Attendance today" })
        .getByRole("row", { name: /Ella Onshift/ }),
    ).toContainText("Clocked in");
    await expect(page.getByRole("main")).not.toContainText(NO_LEAKS);
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "e9-3k-facility-attendance");

    // Compliance: what the agency shared, against Mercy's requirements; no documents.
    await page.goto(`${base}/compliance`);
    const shared = page.getByRole("table", { name: `Workers shared by ${world.agencyName}` });
    await expect(shared.getByRole("row", { name: /Wendy Ready/ })).toContainText("Ready");
    await expect(page.getByRole("button", { name: /Open document/ })).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText(NO_LEAKS);
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "e9-3k-facility-compliance");

    // Agency-only and finance routes do not exist for a facility.
    await expectNotFound(page, [
      `${base}/workforce`,
      `${base}/shifts`,
      `${base}/operations`,
      `${base}/facilities`,
      `${base}/rates`,
      `${base}/pricing`,
      `${base}/payroll`,
      `${base}/invoices`,
      `${base}/settings/rates`,
      `${base}/settings/payroll`,
      `${base}/settings/compliance`,
    ]);
    await page.context().close();
  });

  test("Facility Scheduler: staffing, coverage, compliance and messages; no sign-off or member admin", async ({
    browser,
  }, testInfo) => {
    const page = await signedIn(browser, scheduler.email);
    await page.goto(base);
    expect(await navLabels(page, testInfo)).toEqual([
      "Overview",
      "Staffing requests",
      "Coverage",
      "Attendance",
      "Compliance",
      "Messages",
      "Settings",
    ]);
    await expect(page.getByRole("link", { name: "Request staff" })).toBeVisible();
    await page.goto(`${base}/compliance`);
    await expect(page.getByRole("heading", { level: 1, name: "Compliance" })).toBeVisible();
    await expectNotFound(page, [`${base}/timesheets`, `${base}/payroll`, `${base}/workforce`]);
    await page.goto(`${base}/settings/team`);
    await expect(page.getByRole("button", { name: "Create invitation" })).toHaveCount(0);
    await page.context().close();
  });

  test("Facility Supervisor: limited view; no staffing administration, compliance or messages", async ({
    browser,
  }, testInfo) => {
    const page = await signedIn(browser, supervisor.email);
    await page.goto(base);
    expect(await navLabels(page, testInfo)).toEqual([
      "Overview",
      "Staffing requests",
      "Coverage",
      "Attendance",
      "Sign-off",
      "Settings",
    ]);
    await expect(page.getByRole("link", { name: "Request staff" })).toHaveCount(0);
    await page.goto(`${base}/attendance`);
    await expect(
      page
        .getByRole("table", { name: "Attendance today" })
        .getByRole("row", { name: /Ella Onshift/ }),
    ).toContainText("Clocked in");
    await expectNoA11yViolations(page);
    await expectNotFound(page, [`${base}/compliance`, `${base}/conversations`]);
    await page.goto(`${base}/staffing-requests`);
    await expect(page.getByRole("button", { name: "Submit request" })).toHaveCount(0);
    await page.context().close();
  });

  test("Isolation: another facility cannot reach this facility's workspace", async ({
    browser,
  }) => {
    const page = await signedIn(browser, other.facilityAdmin.email);
    await expectNotFound(page, [
      base,
      `${base}/staffing-requests`,
      `${base}/coverage`,
      `${base}/attendance`,
      `${base}/compliance`,
      `${base}/conversations`,
      `${base}/timesheets`,
    ]);
    // Its own coverage never lists this facility's workers.
    await page.goto(`/app/organisations/${other.facilityOrgId}/coverage?view=upcoming`);
    await expect(page.getByRole("main")).not.toContainText(/Ella Onshift/);
    const direct = await other.facilityAdmin.client.rpc("list_facility_coverage", {
      p_facility_organisation_id: world.facilityOrgId,
      p_from: isoDay(-1),
      p_to: isoDay(14),
    });
    expect(direct.error?.code).toBe("CH403");
    await page.context().close();
  });
});
