import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import {
  agencyWorker,
  createStaffingWorld,
  facilityMember,
  type Person,
  type StaffingWorld,
} from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn } from "./support";

/*
 * P0-E9-3B worker-first app entry: a worker-only account lands on its work
 * (one agency → My Shifts; several → a worker-only agency chooser), while
 * staff, mixed and facility accounts keep the existing workspace gateway.
 */

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const AFTER_ACTION = { timeout: 20_000 };

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
  expect(results.violations).toEqual([]);
  await expectNoPageOverflow(page);
}

async function signedInPage(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email);
  return page;
}

test.describe.serial("worker-first app entry", () => {
  test.setTimeout(240_000);

  let world: StaffingWorld;
  let betaName: string;
  let solo: Person;
  let duo: Person;
  let workerAndSupervisor: Person;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    const tag = `entry-${Date.now().toString(36)}`;
    world = await createStaffingWorld(tag);
    betaName = `Beta Agency ${tag}`;
    solo = await agencyWorker(world, "e2e-entry-solo", "Sol Solo", "primary");
    duo = await agencyWorker(world, "e2e-entry-duo", "Dua Duo", "primary");
    await agencyWorker(world, "", "", "beta", duo);
    workerAndSupervisor = await agencyWorker(world, "e2e-entry-mixed", "Max Mixed", "primary");
    await facilityMember(world, "", "", "facility.supervisor", workerAndSupervisor);
    // Bea owns the Beta agency and is a healthcare worker of the main agency.
    await agencyWorker(world, "", "", "primary", world.betaAdmin);
  });

  test("1. a worker of one agency signs in straight to that agency's My Shifts", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, solo.email);
    const myShifts = new RegExp(`/app/organisations/${world.agencyId}/my-shifts$`);
    await expect(page).toHaveURL(myShifts, AFTER_ACTION);
    await expect(page.getByRole("navigation", { name: "Worker" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Welcome" })).toHaveCount(0);
    // Opening /app again (e.g. the logo, a bookmark) resolves the same way.
    await page.goto("/app");
    await expect(page).toHaveURL(myShifts);
    await qaScreenshot(page, "e9-3b-single-agency-my-shifts");
    await page.context().close();
  });

  test("2–3. a worker of two agencies chooses one; no Create agency", async ({ browser }) => {
    const page = await signedInPage(browser, duo.email);
    await expect(page).toHaveURL(/\/app$/, AFTER_ACTION);
    await expect(page.getByRole("heading", { level: 1, name: "Choose an agency" })).toBeVisible();
    const list = page.getByRole("list", { name: "Your agencies" });
    await expect(list.getByRole("article")).toHaveCount(2);
    for (const name of [world.agencyName, betaName]) {
      const card = list.getByRole("article", { name });
      await expect(card.getByRole("heading", { level: 2, name })).toBeVisible();
      await expect(card.getByText("Healthcare Worker")).toBeVisible();
      await expect(card.getByRole("link", { name: `Open shifts with ${name}` })).toBeVisible();
    }
    // Worker-only: no agency creation and no staff workspace gateway.
    await expect(page.getByRole("region", { name: "Create a new agency" })).toHaveCount(0);
    await expect(page.getByText("Create a new agency")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Your organisations" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Open workspace/ })).toHaveCount(0);
    await qaScreenshot(page, "e9-3b-worker-agency-chooser");
    await expectNoA11yViolations(page);

    await list.getByRole("link", { name: `Open shifts with ${betaName}` }).click();
    await expect(page).toHaveURL(
      new RegExp(`/app/organisations/${world.betaId}/my-shifts$`),
      AFTER_ACTION,
    );
    await expect(page.getByRole("navigation", { name: "Worker" })).toBeVisible();
    await page.context().close();
  });

  test("4. an agency admin keeps the existing workspace gateway", async ({ browser }) => {
    const page = await signedInPage(browser, world.admin.email);
    await expect(page).toHaveURL(/\/app$/, AFTER_ACTION);
    await expect(page.getByRole("heading", { level: 1, name: /^Welcome/ })).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: "Your organisations" })
        .getByRole("button", { name: `Open workspace ${world.agencyName}` }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Create a new agency" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Your agencies" })).toHaveCount(0);
    await page.context().close();
  });

  test("5. mixed accounts keep the general gateway", async ({ browser }) => {
    // Admin of one agency and worker of another.
    const owner = await signedInPage(browser, world.betaAdmin.email);
    await expect(owner).toHaveURL(/\/app$/, AFTER_ACTION);
    const ownerList = owner.getByRole("list", { name: "Your organisations" });
    await expect(ownerList.getByRole("article")).toHaveCount(2);
    await expect(owner.getByRole("region", { name: "Create a new agency" })).toBeVisible();
    await expect(owner.getByRole("list", { name: "Your agencies" })).toHaveCount(0);
    await owner.context().close();

    // Worker of the agency and supervisor at the facility.
    const mixed = await signedInPage(browser, workerAndSupervisor.email);
    await expect(mixed).toHaveURL(/\/app$/, AFTER_ACTION);
    const mixedList = mixed.getByRole("list", { name: "Your organisations" });
    await expect(mixedList.getByRole("article", { name: world.agencyName })).toBeVisible();
    await expect(mixedList.getByRole("article", { name: world.facilityOrgName })).toBeVisible();
    await expect(mixed.getByRole("list", { name: "Your agencies" })).toHaveCount(0);
    await mixed.context().close();
  });

  test("6. a facility admin keeps the existing workspace gateway", async ({ browser }) => {
    const page = await signedInPage(browser, world.facilityAdmin.email);
    await expect(page).toHaveURL(/\/app$/, AFTER_ACTION);
    await expect(
      page
        .getByRole("list", { name: "Your organisations" })
        .getByRole("article", { name: world.facilityOrgName }),
    ).toBeVisible();
    await expect(page.getByRole("list", { name: "Your agencies" })).toHaveCount(0);
    await page.context().close();
  });

  test("7. workers still reach Account, Security and Sign out", async ({ browser }) => {
    // From My Shifts, through the worker shell's More sheet.
    const page = await signedInPage(browser, solo.email);
    await expect(page).toHaveURL(/\/my-shifts$/, AFTER_ACTION);
    const nav = page.getByRole("navigation", { name: "Worker" });
    await nav.getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await sheet.getByRole("link", { name: "Account" }).click();
    await expect(page).toHaveURL(/\/app\/account$/);
    await expect(page.getByRole("region", { name: "Profile details" })).toBeVisible();
    const account = page.getByRole("navigation", { name: "Account" });
    await account.getByRole("link", { name: "Security" }).click();
    await expect(page).toHaveURL(/\/app\/security$/);
    await expect(page.getByRole("region", { name: "Authenticator app" })).toBeVisible();
    await account.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/, AFTER_ACTION);
    await page.context().close();

    // From the worker agency chooser, through the personal frame.
    const chooser = await signedInPage(browser, duo.email);
    await expect(chooser).toHaveURL(/\/app$/, AFTER_ACTION);
    const personal = chooser.getByRole("navigation", { name: "Account" });
    await expect(personal.getByRole("link", { name: "Account" })).toHaveAttribute(
      "href",
      "/app/account",
    );
    await expect(personal.getByRole("link", { name: "Security" })).toHaveAttribute(
      "href",
      "/app/security",
    );
    await personal.getByRole("button", { name: "Sign out" }).click();
    await expect(chooser).toHaveURL(/\/sign-in/, AFTER_ACTION);
    await chooser.context().close();
  });

  test("8. worker permissions are unchanged: staff pages stay unavailable", async ({ browser }) => {
    const page = await signedInPage(browser, duo.email);
    await expect(page).toHaveURL(/\/app$/, AFTER_ACTION);
    for (const path of ["workforce", "shifts", "facilities"]) {
      const response = await page.goto(`/app/organisations/${world.agencyId}/${path}`);
      expect(response?.status()).toBe(404);
    }
    await page.context().close();
  });
});
