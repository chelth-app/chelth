import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import { generateTotp } from "../support/totp";
import { createStaffingWorld, type StaffingWorld } from "./staffing-fixture";
import {
  expectNoPageOverflow,
  qaScreenshot,
  signIn,
  SIGNED_IN_LANDING,
  signUpAndConfirm,
  uniqueEmail,
} from "./support";

/*
 * P0-E9-4A.2: /app is an organisation switcher; one staffing business per
 * self-service owner; an additional business is a commercial request that
 * Chelth fulfils with its own account.
 */

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const AFTER_ACTION = { timeout: 20_000 };

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

test.describe.serial("Organisation gateway & additional business (P0-E9-4A.2)", () => {
  test.setTimeout(240_000);
  let world: StaffingWorld;
  let businessName: string;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    const tag = `${testInfo.project.name.split("-")[0] ?? "e2e"}-${Date.now().toString(36)}`;
    world = await createStaffingWorld(`e94a2-${tag}`);
    businessName = `Acme Medical Staffing ${tag}`;
  });

  test("a first-time user is offered their staffing agency", async ({ page }) => {
    await signUpAndConfirm(page, "Nia New", uniqueEmail("e2e-first-agency"));
    await page.goto("/app");
    await expect(page.getByRole("region", { name: "Create your staffing agency" })).toBeVisible();
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "e9-4a2-first-time");
  });

  test("an owner gets a clean chooser and requests an additional business", async ({ browser }) => {
    const page = await signedIn(browser, world.admin.email);
    await page.goto("/app");
    await expect(
      page
        .getByRole("list", { name: "Your organizations" })
        .getByRole("article", { name: world.agencyName }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Create your staffing agency" })).toHaveCount(0);
    await expect(page.getByText(/Create a new agency/)).toHaveCount(0);
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "e9-4a2-owner-chooser");

    // The database refuses a second self-service agency, whatever the client.
    const direct = await world.admin.client.rpc("create_organisation", {
      p_type: "agency",
      p_name: `${world.agencyName} Lagos`,
      p_slug: `lagos-${Date.now().toString(36)}`,
    });
    expect(direct.error?.code).toBe("CHB01");

    await page.goto("/app/account");
    const businesses = page.getByRole("region", { name: "Businesses" });
    await expect(businesses).toContainText("You own 1 staffing business");
    await expect(businesses).toContainText("Facilities inside your agency workspace");
    await businesses.getByText("Add another business").click();
    await expect(businesses).toContainText("separate Chelth subscriptions, teams and data");
    await businesses.getByRole("textbox", { name: "Business name" }).fill(businessName);
    await businesses
      .getByRole("textbox", { name: "Billing contact email" })
      .fill("billing@acme.test");
    await businesses.getByRole("button", { name: "Request additional business" }).click();
    await expect(businesses.getByRole("status")).toContainText("Request sent", AFTER_ACTION);
    await page.reload();
    await expect(page.getByRole("list", { name: "Additional business requests" })).toContainText(
      "Waiting for Chelth",
    );
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "e9-4a2-account-businesses");
    await page.context().close();
  });

  test("a worker who owns nothing can still start their own agency (from Account)", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.wendy.email);
    await page.goto("/app/account");
    const businesses = page.getByRole("region", { name: "Businesses" });
    await expect(businesses).toContainText("You don't own a staffing business on Chelth yet");
    await expect(
      businesses.getByText("Create your staffing agency", { exact: true }),
    ).toBeVisible();
    await page.context().close();
  });

  test("Chelth fulfils the request with its own commercial account", async ({ browser }) => {
    const page = await signedIn(browser, world.operator.email);
    await page.goto("/platform");
    await page.getByRole("link", { name: "Verify now" }).click();
    await page
      .getByLabel("Authentication code")
      .fill(generateTotp(world.operator.totpSecret ?? ""));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/platform$/, AFTER_ACTION);
    await page.goto("/platform/billing");
    const request = page
      .getByRole("list", { name: "Additional business requests" })
      .getByRole("listitem")
      .filter({ hasText: businessName });
    await expect(request).toContainText(world.agencyName); // what the requester already owns
    await request.getByRole("combobox", { name: "Start as" }).selectOption("trial");
    await request.getByRole("combobox", { name: "Plan" }).selectOption({ label: "Pilot" });
    await request
      .getByRole("textbox", { name: "Reason" })
      .first()
      .fill("Separate legal entity confirmed");
    await request.getByRole("button", { name: `Create ${businessName}` }).click();
    // The request row itself becomes the confirmation (it is no longer pending).
    await expect(request).toContainText("Created", AFTER_ACTION);
    await expect(request.getByRole("link", { name: "Open the new business" })).toBeVisible();
    await page.goto("/platform/organisations?filter=trial");
    await expect(
      page
        .getByRole("table", { name: "Organizations" })
        .getByRole("row", { name: new RegExp(businessName) }),
    ).toContainText("Trial");
    await page.context().close();

    // The owner now has two businesses, each its own organisation.
    const owner = await signedIn(browser, world.admin.email);
    await owner.goto("/app");
    const list = owner.getByRole("list", { name: "Your organizations" });
    await expect(list.getByRole("article", { name: businessName })).toBeVisible();
    await expect(list.getByRole("article", { name: world.agencyName })).toBeVisible();
    await owner.context().close();
  });
});
