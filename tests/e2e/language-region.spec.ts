import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import { generateTotp } from "../support/totp";
import { createStaffingWorld, type StaffingWorld } from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn, SIGNED_IN_LANDING } from "./support";

/*
 * P0-E9-3I: Language & Region. Workspace spelling (en-US ⇄ en-GB) across
 * representative pages, currency as a separate default, and the person's own
 * language on personal pages only.
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

test.describe.serial("Language & Region (P0-E9-3I)", () => {
  test.setTimeout(240_000);
  let world: StaffingWorld;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`e93i-${testInfo.project.name.split("-")[0] ?? "e2e"}`);
  });

  test("workspace spelling follows the workspace language; currency is separate", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.admin.email);
    const base = `/app/organisations/${world.agencyId}`;
    const facility = `${base}/facilities/${world.facilityId}`;
    await page.goto(facility);
    await page.getByRole("link", { name: "Verify now" }).first().click();
    await page.getByLabel("Authentication code").fill(generateTotp(world.admin.totpSecret ?? ""));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(new RegExp(`${facility}$`), AFTER_ACTION);

    // Default (not set ⇒ en-US): American spelling everywhere.
    await expect(page.getByRole("main")).toContainText("Linked to a CHELTH facility organization");
    await page.goto(`${base}/settings`);
    const details = page.getByRole("region", { name: "Workspace Details" });
    await expect(details).toContainText("Basic information about your organization and workspace.");
    const region = page.getByRole("region", { name: "Language & Region" });
    await expect(region).toContainText("Controls spelling and terminology across this workspace.");
    await expect(region.getByLabel("Currency")).toHaveValue("USD"); // suggested from en-US
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "e9-3i-language-region");

    // Currency: a separate setting with its own save.
    await region.getByLabel("Currency").selectOption("GBP");
    await region.getByRole("button", { name: "Save currency" }).click();
    await expect(region.getByText("Workspace currency saved.")).toBeVisible(AFTER_ACTION);

    // en-GB: British spelling on the same pages; the currency stays GBP (not reset).
    await region.getByLabel("Language").selectOption("en-GB");
    await region.getByRole("button", { name: "Save language" }).click();
    await expect(region.getByText("Workspace language saved.")).toBeVisible(AFTER_ACTION);
    await page.goto(`${base}/settings`);
    await expect(page.getByRole("region", { name: "Workspace Details" })).toContainText(
      "Basic information about your organisation and workspace.",
    );
    await expect(
      page.getByRole("region", { name: "Language & Region" }).getByLabel("Currency"),
    ).toHaveValue("GBP");
    await page.goto(facility);
    await expect(page.getByRole("main")).toContainText("Linked to a CHELTH facility organisation");
    await expect(page.getByRole("main")).not.toContainText("organization");
    await page.goto(`${base}/compliance`);
    await expect(page.getByLabel("Jurisdiction (licences)").first()).toBeVisible();
    // The new rate form preselects the workspace currency and says it is never converted.
    await page.goto(`${base}/rates`);
    await page.getByRole("link", { name: "Add Rate Card" }).first().click();
    const form = page.getByRole("region", { name: "Add a rate card" });
    await expect(form.getByLabel("Currency")).toHaveValue("GBP");
    await expect(form).toContainText("Workspace currency: GBP");
    await expectNoA11yViolations(page);

    // Back to en-US: no mixed spelling left behind.
    await page.goto(`${base}/settings`);
    const again = page.getByRole("region", { name: "Language & Region" });
    await again.getByLabel("Language").selectOption("en-US");
    await again.getByRole("button", { name: "Save language" }).click();
    await expect(again.getByText("Workspace language saved.")).toBeVisible(AFTER_ACTION);
    await page.goto(facility);
    await expect(page.getByRole("main")).toContainText("Linked to a CHELTH facility organization");
    await expect(page.getByRole("main")).not.toContainText("organisation");
    await page.goto(`${base}/compliance`);
    await expect(page.getByLabel("Jurisdiction (licenses)").first()).toBeVisible();
    await page.context().close();
  });

  test("a person's own language applies to personal pages, not inside a US workspace", async ({
    browser,
  }) => {
    const prefs = await world.wendy.client.rpc("set_my_display_preferences", {
      p_timezone_mode: "automatic",
      p_locale: "en-GB",
    });
    if (prefs.error) throw prefs.error;
    const locale = await world.admin.client.rpc("set_organisation_locale", {
      p_organisation_id: world.agencyId,
      p_locale: "en-US",
    });
    if (locale.error) throw locale.error;
    const page = await signedIn(browser, world.wendy.email);
    // Personal page: the person's own language (en-GB).
    await page.goto("/app/account");
    await expect(page.getByRole("link", { name: "Organisations", exact: true })).toBeVisible();
    await page.goto(`/app/organisations/${world.agencyId}/my-credentials`);
    await expect(page.getByRole("main")).not.toContainText(/licence|organisation/i);
    await expectNoA11yViolations(page);
    await page.context().close();
  });
});
