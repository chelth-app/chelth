import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import { createStaffingWorld, isoDay, type StaffingWorld } from "./staffing-fixture";
import { expectNoPageOverflow, openWorkspaceSection, signIn } from "./support";

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
/** Server Actions re-render the page; allow for a loaded local stack. */
const AFTER_ACTION = { timeout: 20_000 };

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
  expect(results.violations).toEqual([]);
  // P0-E8-S2: wide tables scroll inside their region, never the page (412 px on mobile).
  await expectNoPageOverflow(page);
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app$/);
  return page;
}

test.describe.serial("shift requests & assignments", () => {
  test.setTimeout(240_000);

  let world: StaffingWorld;
  let scheduler: Page;
  let shiftPath: string;
  let requestId: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(testInfo.project.name.split("-")[0] ?? "e2e");
    scheduler = await signedIn(browser, world.scheduler.email);
  });

  test("Flow 1: a scheduler creates a shift, sees eligible workers, assigns and sees fill progress", async () => {
    await scheduler.goto(`/app/organisations/${world.agencyId}`);
    await openWorkspaceSection(scheduler, "Shifts");
    await expect(scheduler.getByRole("heading", { level: 1, name: "Shifts" })).toBeVisible();
    // Locked P3: the existing form is revealed by "+ Create shift" (same route, same action).
    await expect(scheduler.getByRole("heading", { name: "Create a shift" })).toBeHidden();
    await scheduler.getByRole("link", { name: "Create shift" }).click();
    await expect(scheduler.getByRole("heading", { name: "Create a shift" })).toBeVisible();

    await scheduler
      .getByRole("combobox", { name: "Facility and location" })
      .selectOption({ label: "Mercy Rehab — Mercy Main (America/New_York)" });
    await scheduler
      .getByRole("combobox", { name: "Discipline" })
      .selectOption({ label: "Certified Nursing Assistant (CNA)" });
    await scheduler.getByLabel("Shift date").fill(isoDay(3));
    await scheduler.getByLabel("Start time").fill("07:00");
    await scheduler.getByLabel("End time").fill("15:00");
    await scheduler.getByRole("spinbutton", { name: "Workers needed" }).fill("2");
    await scheduler.getByRole("button", { name: "Create shift" }).click();
    await expect(
      scheduler.getByRole("heading", {
        level: 1,
        name: /Mercy Rehab · Certified Nursing Assistant/,
      }),
    ).toBeVisible();
    shiftPath = new URL(scheduler.url()).pathname;
    await expect(scheduler.getByText("7:00 AM – 3:00 PM")).toBeVisible();

    const eligible = scheduler.getByRole("list", { name: "Eligible workers" });
    await expect(eligible).toContainText("Wendy Ready");
    await expect(eligible).not.toContainText("Nina Missing");
    await expectNoA11yViolations(scheduler);

    await eligible.getByRole("button", { name: "Assign: Wendy Ready" }).click();
    await expect(scheduler.getByText("Partially filled · 1 of 2")).toBeVisible(AFTER_ACTION);
    await expect(scheduler.getByRole("region", { name: "Assigned workers" })).toContainText(
      "Wendy Ready",
    );
  });

  test("Flow 4: an ineligible worker's assignment fails with an explainable reason", async () => {
    await scheduler.goto(shiftPath);
    await scheduler.getByText(/Unavailable workers/).click();
    const unavailable = scheduler.getByRole("list", { name: "Unavailable workers" });
    await expect(unavailable).toContainText("Nina Missing");
    await unavailable.getByRole("button", { name: "Try to assign: Nina Missing" }).click();
    await expect(
      scheduler
        .getByRole("alert")
        .filter({ hasText: "not compliant for this facility on the shift date" }),
    ).toBeVisible(AFTER_ACTION);
    await expect(
      scheduler.getByRole("list", { name: "Why Nina Missing cannot be assigned" }),
    ).toContainText("Facility orientation (facility requirement): Missing");
    await scheduler.reload();
    await expect(scheduler.getByRole("heading", { name: "Assignment decisions" })).toBeVisible();
    await expect(scheduler.getByText(/Nina Missing · Refused/)).toBeVisible();
  });

  test("Flow 2: the worker sees and accepts only their own assignment", async ({ browser }) => {
    const wendy = await signedIn(browser, world.wendy.email);
    await wendy.goto(`/app/organisations/${world.agencyId}`);
    await wendy.getByRole("link", { name: "My shifts" }).click();
    await expect(wendy.getByRole("heading", { level: 1, name: "My shifts" })).toBeVisible();
    const items = wendy.getByRole("listitem").filter({ hasText: "Mercy Rehab" });
    await expect(items).toHaveCount(1);
    await expect(items).toContainText("Awaiting response");
    await expectNoA11yViolations(wendy);
    await wendy.getByRole("button", { name: "Accept shift at Mercy Rehab" }).click();
    await expect(items).toContainText("Accepted", AFTER_ACTION);

    // No agency shift screens and nobody else's assignments.
    const direct = await wendy.goto(shiftPath);
    expect(direct?.status()).toBe(404);
    const nina = await signedIn(browser, world.nina.email);
    await nina.goto(`/app/organisations/${world.agencyId}/my-shifts`);
    await expect(nina.getByText("You have no assignments yet.")).toBeVisible();
    await wendy.context().close();
    await nina.context().close();
  });

  test("Flow 3: a facility submits a request; the agency opens and fills it; the facility sees progress and a safe projection", async ({
    browser,
  }) => {
    const facility = await signedIn(browser, world.facilityAdmin.email);
    await facility.goto(`/app/organisations/${world.facilityOrgId}`);
    await openWorkspaceSection(facility, "Staffing requests");
    await expect(
      facility.getByRole("heading", { level: 1, name: "Staffing requests" }),
    ).toBeVisible();
    await facility
      .getByRole("combobox", { name: "Agency and location" })
      .selectOption({ label: `${world.agencyName} — Mercy Main (America/New_York)` });
    await facility
      .getByRole("combobox", { name: "Discipline" })
      .selectOption({ label: "Certified Nursing Assistant (CNA)" });
    await facility.getByLabel("Shift date").fill(isoDay(6));
    await facility.getByLabel("Start time").fill("19:00");
    await facility.getByLabel("End time").fill("07:00");
    await facility.getByLabel("Instructions for workers").fill("Use the staff entrance");
    await facility.getByRole("button", { name: "Submit request" }).click();
    await expect(facility.getByText("Requested", { exact: true })).toBeVisible(AFTER_ACTION);
    await expect(facility.getByText("7:00 PM – 7:00 AM (+1 day)")).toBeVisible();
    requestId = new URL(facility.url()).pathname.split("/").pop() ?? "";
    await expectNoA11yViolations(facility);

    await scheduler.goto(`/app/organisations/${world.agencyId}/shifts/${requestId}`);
    await scheduler.getByRole("button", { name: "Accept and open request" }).click();
    await expect(scheduler.getByText("Open", { exact: true })).toBeVisible(AFTER_ACTION);
    const eligible = scheduler.getByRole("list", { name: "Eligible workers" });
    await expect(eligible).toContainText("Wendy Ready");
    await eligible.getByRole("button", { name: "Assign: Wendy Ready" }).click();
    await expect(scheduler.getByText("Filled · 1 of 1")).toBeVisible(AFTER_ACTION);

    await facility.reload();
    await expect(facility.getByText("Filled · 1 of 1")).toBeVisible();
    const coming = facility.getByRole("region", { name: "Who is coming" });
    await expect(coming).toContainText("Wendy Ready");
    await expect(coming).toContainText("Ready");
    await expect(coming).not.toContainText("@");
    await facility.context().close();
  });

  test("Flow 5: another agency and the facility cannot reach agency shift routes or records", async ({
    browser,
  }) => {
    const beta = await signedIn(browser, world.betaAdmin.email);
    for (const path of [
      `/app/organisations/${world.agencyId}/shifts`,
      shiftPath,
      `/app/organisations/${world.agencyId}/shifts/${requestId}`,
      `/app/organisations/${world.facilityOrgId}/staffing-requests`,
      `/app/organisations/${world.facilityOrgId}/staffing-requests/${requestId}`,
    ]) {
      const response = await beta.goto(path);
      expect(response?.status(), path).toBe(404);
    }
    await beta.context().close();

    const facility = await signedIn(browser, world.facilityAdmin.email);
    for (const path of [`/app/organisations/${world.agencyId}/shifts`, shiftPath]) {
      const response = await facility.goto(path);
      expect(response?.status(), path).toBe(404);
    }
    await facility.context().close();
  });
});
