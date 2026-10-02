import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import {
  adminWithVerifiedAgency as adminWithVerifiedAgencyShared,
  expectNoPageOverflow,
  openWorkspaceSection,
  signUpAndConfirm,
  uniqueEmail,
} from "./support";

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];

async function adminWithVerifiedAgency(page: Page, agencyName: string): Promise<string> {
  return adminWithVerifiedAgencyShared(page, agencyName, uniqueEmail("e2e-s3-admin"));
}

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
  expect(results.violations).toEqual([]);
  // P0-E8-S2: wide tables scroll inside their region, never the page (412 px on mobile).
  await expectNoPageOverflow(page);
}

test.describe("workforce", () => {
  test.setTimeout(150_000);

  test("admin invites a worker; the worker sees only their own limited record", async ({
    page,
    browser,
  }) => {
    const organisationUrl = await adminWithVerifiedAgency(page, "Workforce Agency");

    await openWorkspaceSection(page, "Workforce");
    await expect(page.getByRole("heading", { level: 1, name: "Workforce" })).toBeVisible();
    await expect(page.getByText("No workers yet.")).toBeVisible();
    await expectNoA11yViolations(page);

    const workerEmail = uniqueEmail("e2e-s3-worker");
    await page.getByLabel("Worker email address").fill(workerEmail);
    await page.getByRole("button", { name: "Invite worker" }).click();
    // Email delivery is disabled in tests: the link is shown once instead.
    await expect(page.getByText("Email delivery is not configured yet")).toBeVisible();
    const inviteUrl = new URL(await page.getByTestId("invite-link").inputValue());

    const workerContext = await browser.newContext();
    const workerPage = await workerContext.newPage();
    await workerPage.goto(inviteUrl.pathname);
    await signUpAndConfirm(workerPage, "Wren Worker", workerEmail);
    await workerPage.getByRole("link", { name: "Review invitation" }).click();
    await expect(workerPage.getByText("Healthcare Worker")).toBeVisible();
    await workerPage.getByRole("button", { name: "Accept invitation" }).click();

    // Worker self-access: own record, no workforce section, no other workers.
    await expect(workerPage.getByRole("heading", { name: "My worker record" })).toBeVisible();
    await expect(workerPage.getByText("Onboarding")).toBeVisible();
    await expect(workerPage.getByRole("link", { name: "Workforce" })).toHaveCount(0);
    const forbidden = await workerPage.goto(`${organisationUrl}/workforce`);
    expect(forbidden?.status()).toBe(404);

    // Admin sees and activates the worker.
    await page.reload();
    await page.getByRole("link", { name: "Wren Worker" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Wren Worker" })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole("button", { name: "Set active" }).click();
    await expect(page.locator("main header").getByText("Active")).toBeVisible();

    await page.getByLabel("Add internal note").fill("Prefers early shifts.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Prefers early shifts.")).toBeVisible();

    await workerPage.goto(organisationUrl);
    await expect(workerPage.getByText("Active")).toBeVisible();
    await expect(workerPage.getByText("Prefers early shifts.")).toHaveCount(0);
    await workerContext.close();
  });
});

test.describe("facilities", () => {
  test.setTimeout(150_000);

  test("admin creates a client facility, a location and an active relationship", async ({
    page,
    browser,
  }) => {
    const organisationUrl = await adminWithVerifiedAgency(page, "Facility Agency");

    await openWorkspaceSection(page, "Facilities");
    await expect(page.getByText("No client facilities yet.")).toBeVisible();
    await expectNoA11yViolations(page);

    await page.getByLabel("Facility name").fill("Riverside Care Home");
    await page
      .getByRole("combobox", { name: "Facility type" })
      .selectOption({ label: "Skilled nursing facility" });
    await page
      .getByRole("combobox", { name: "Timezone", exact: true })
      .selectOption("Europe/London");
    await page.getByLabel("Town or city").fill("Leeds");
    await page.getByRole("button", { name: "Create facility" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: "Riverside Care Home" }),
    ).toBeVisible();
    const facilityUrl = new URL(page.url()).pathname;

    await page.getByLabel("Location name").fill("North Wing");
    await page.getByRole("button", { name: "Add location" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "North Wing" })).toBeVisible();

    await page.getByRole("button", { name: "Start relationship" }).click();
    await expect(page.getByText("Pending")).toBeVisible();
    await page.getByRole("button", { name: "Activate relationship" }).click();
    await expect(
      page.locator("section").filter({ hasText: "Relationship" }).getByText("Active"),
    ).toBeVisible();
    await expectNoA11yViolations(page);

    await page.goto(`${organisationUrl}/facilities`);
    await expect(page.getByRole("link", { name: "Riverside Care Home" })).toBeVisible();

    // Another tenant's user cannot reach these routes.
    const outsiderContext = await browser.newContext();
    const outsider = await outsiderContext.newPage();
    await signUpAndConfirm(outsider, "Otto Outsider", uniqueEmail("e2e-s3-outsider"));
    for (const path of [
      organisationUrl,
      `${organisationUrl}/facilities`,
      facilityUrl,
      `${organisationUrl}/workforce`,
    ]) {
      const response = await outsider.goto(path);
      expect(response?.status(), path).toBe(404);
    }
    await outsiderContext.close();
  });
});
