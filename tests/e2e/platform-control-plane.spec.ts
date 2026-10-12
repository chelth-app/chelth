import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import { generateTotp } from "../support/totp";
import {
  createStaffingWorld,
  grantPlatformAdmin,
  type Person,
  type StaffingWorld,
} from "./staffing-fixture";
import {
  expectNoPageOverflow,
  qaScreenshot,
  signIn,
  SIGNED_IN_LANDING,
  uniqueEmail,
} from "./support";

/*
 * P0-E9-4A: the Chelth platform control plane. A separate context from every
 * tenant: platform admins administer customers, provisioning, links and
 * commercial accounts without becoming members or gaining tenant authority.
 */

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const AFTER_ACTION = { timeout: 20_000 };
const NO_TENANT_DATA =
  /pay rate|bill rate|payroll batch|latitude|longitude|40\.71|wendy\.|@example/i;

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

/** /platform asks an AAL1 session to verify; the existing step-up route returns here. */
async function verifyPlatform(page: Page, who: Person) {
  await page.goto("/platform");
  await page.getByRole("link", { name: "Verify now" }).click();
  await page.getByLabel("Authentication code").fill(generateTotp(who.totpSecret ?? ""));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/platform$/, AFTER_ACTION);
  await expect(
    page.getByRole("heading", { level: 1, name: "Customer administration" }),
  ).toBeVisible();
}

test.describe.serial("Platform control plane (P0-E9-4A)", () => {
  test.setTimeout(300_000);
  let world: StaffingWorld;
  let newFacilityRecordId: string;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(300_000);
    // The platform directory is global: names must be unique per run, not just per project.
    world = await createStaffingWorld(
      `e94a-${testInfo.project.name.split("-")[0] ?? "e2e"}-${Date.now().toString(36)}`,
    );
    // An unlinked facility record of the world's agency, ready for an explicit link.
    const created = await world.admin.client.rpc("create_agency_facility", {
      p_agency_organisation_id: world.agencyId,
      p_name: `Harbor View ${testInfo.project.name.split("-")[0]}`,
      p_facility_type: "hospital",
      p_timezone: "America/Chicago",
    });
    if (created.error) throw created.error;
    newFacilityRecordId = created.data;
  });

  test("a platform admin with no memberships administers customers from /platform", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.operator.email);
    // No memberships ⇒ /app opens the control plane.
    await page.goto("/app");
    await expect(page).toHaveURL(/\/platform$/, AFTER_ACTION);
    await verifyPlatform(page, world.operator);
    await expect(page.getByRole("banner")).toContainText("CHELTH PLATFORM");
    await expect(page.getByRole("banner")).toContainText("Platform administration");
    await expect(
      page.getByRole("navigation", { name: "Platform administration" }).getByRole("link"),
    ).toHaveText(["Overview", "Organizations", "Billing", "System", "Admins", "Activity"]);
    await expect(page.getByRole("navigation", { name: "Workspace" })).toHaveCount(0);
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "e9-4a-platform-overview");

    // Directory: the world's agency and facility organisation, safe metadata only.
    await page.goto("/platform/organisations");
    const directory = page.getByRole("table", { name: "Organizations" });
    await expect(directory.getByRole("row", { name: new RegExp(world.agencyName) })).toContainText(
      "Commercial setup required",
    );
    await expect(
      directory.getByRole("row", { name: new RegExp(world.facilityOrgName) }),
    ).toContainText("Facility");
    await expect(page.getByRole("main")).not.toContainText(NO_TENANT_DATA);
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "e9-4a-platform-directory");

    // Provision a facility organisation; the owner is invited (the operator never joins).
    const facilityName = `Lakeside Clinic ${Date.now().toString(36)}`;
    const create = page.getByRole("region", { name: "Create an organization" });
    await create.getByRole("combobox", { name: "Organization type" }).selectOption("facility");
    await create.getByRole("textbox", { name: "Name" }).fill(facilityName);
    await create.getByRole("textbox", { name: "Owner email" }).fill(uniqueEmail("e2e-4a-owner"));
    await create.getByRole("button", { name: "Create and invite owner" }).click();
    await expect(create.getByRole("status")).toContainText(
      /Invitation emailed|Share this link/,
      AFTER_ACTION,
    );
    await page.reload();
    await page.getByRole("link", { name: facilityName }).click();
    await expect(page.getByRole("heading", { level: 1, name: facilityName })).toBeVisible();
    await expect(page.getByRole("region", { name: "Owner invitations" })).toContainText("Pending");

    // Explicit link: choose the agency, then its facility record, then confirm.
    const links = page.getByRole("region", { name: "Facility links" });
    await links.getByRole("combobox", { name: "Agency" }).selectOption({ label: world.agencyName });
    await links.getByRole("button", { name: "Show facility records" }).click();
    const record = page.getByRole("region", { name: "Facility links" }).getByRole("combobox", {
      name: `${world.agencyName} facility record`,
    });
    await record.selectOption(newFacilityRecordId);
    await page.getByRole("checkbox", { name: /I confirm this facility record/ }).check();
    await page.getByRole("button", { name: "Link facility" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Facility linked:" })).toContainText(
      facilityName,
      AFTER_ACTION,
    );
    await expect(
      page.getByRole("table", { name: "Facility links" }).getByRole("row", { name: /Harbor View/ }),
    ).toContainText(world.agencyName);
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "e9-4a-platform-facility-detail");

    // Commercial account for the agency: explicit setup, no assumed plan.
    await page.goto("/platform/organisations");
    await page.getByRole("link", { name: world.agencyName }).click();
    const commercial = page.getByRole("region", { name: "Commercial account" });
    await expect(commercial).toContainText("Commercial setup required");
    await commercial.getByRole("combobox", { name: "Account status" }).selectOption("trial");
    await commercial.getByRole("combobox", { name: "Plan" }).selectOption({ label: "Pilot" });
    await commercial
      .getByRole("textbox", { name: "Billing contact email" })
      .fill("billing@agency.test");
    await commercial.getByRole("textbox", { name: "Reason" }).fill("Pilot onboarding");
    await commercial.getByRole("button", { name: "Set up account" }).click();
    await expect(commercial.getByText("Commercial account saved.")).toBeVisible(AFTER_ACTION);
    await page.goto("/platform/billing");
    await expect(
      page
        .getByRole("table", { name: "Agency accounts" })
        .getByRole("row", { name: new RegExp(world.agencyName) }),
    ).toContainText("Trial");
    await expect(page.getByText("Payment provider: not connected")).toBeVisible();
    await expect(page.getByRole("button", { name: /charge|card/i })).toHaveCount(0);
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "e9-4a-platform-billing");

    // System, admins and activity (platform events only).
    await page.goto("/platform/system");
    await expect(page.getByRole("heading", { name: "Scheduled jobs" })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText(/secret|api[_ ]?key|https?:\/\//i);
    await expectNoA11yViolations(page);
    await page.goto("/platform/admins");
    await expect(page.getByRole("table", { name: "Platform admins" })).toContainText(
      "Oscar Operator",
    );
    await page.goto("/platform/activity");
    const activity = page.getByRole("list", { name: "Platform activity" });
    await expect(activity).toContainText("Facility linked");
    await expect(activity).toContainText("Commercial account set up");
    await expectNoA11yViolations(page);

    // The platform grant opens no tenant workspace.
    for (const path of [
      `/app/organisations/${world.agencyId}`,
      `/app/organisations/${world.agencyId}/workforce`,
      `/app/organisations/${world.agencyId}/rates`,
      `/app/organisations/${world.agencyId}/payroll`,
      `/app/organisations/${world.facilityOrgId}/coverage`,
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
    await page.context().close();
  });

  test("tenant users never see /platform", async ({ browser }) => {
    for (const who of [world.admin, world.facilityAdmin, world.wendy]) {
      const page = await signedIn(browser, who.email);
      const response = await page.goto("/platform");
      expect(response?.status(), who.email).toBe(404);
      const nested = await page.goto("/platform/organisations");
      expect(nested?.status(), who.email).toBe(404);
      await page.context().close();
    }
  });

  test("a platform admin who is also a scheduler keeps scheduler authority only", async ({
    browser,
  }) => {
    await grantPlatformAdmin(world.scheduler);
    const page = await signedIn(browser, world.scheduler.email);
    await page.goto("/app");
    // Both contexts offered explicitly; nothing entered automatically.
    await expect(page.getByRole("heading", { name: "Platform administration" })).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: "Your organizations" })
        .getByRole("article", { name: world.agencyName }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "e9-4a-platform-chooser");
    await verifyPlatform(page, world.scheduler);
    // Inside the agency: scheduler authority, no admin or finance.
    for (const path of ["rates", "payroll", "settings/rates"]) {
      const response = await page.goto(`/app/organisations/${world.agencyId}/${path}`);
      expect(response?.status(), path).toBe(404);
    }
    await page.goto(`/app/organisations/${world.agencyId}/shifts`);
    await expect(page.getByRole("heading", { level: 1, name: "Shifts" })).toBeVisible();
    await page.context().close();
  });
});
