import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import { markUploadsClean } from "../support/scanner";
import { generateTotp } from "../support/totp";
import { createStaffingWorld, type StaffingWorld } from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn, SIGNED_IN_LANDING } from "./support";

/*
 * P0-E9-3J: agency-defined credentials / requirements. An agency creates its
 * own types (Settings → Compliance, and inline from the requirement form),
 * requires them at baseline and facility level, and a worker satisfies one
 * through the normal evidence → verification flow.
 */

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const AFTER_ACTION = { timeout: 20_000 };
const PDF = Buffer.from("%PDF-1.4\n% Chelth E2E custom requirement evidence\n%%EOF\n");

function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

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

test.describe.serial("Custom certifications & requirements (P0-E9-3J)", () => {
  test.setTimeout(240_000);
  let world: StaffingWorld;
  let base: string;
  const inlineName = "Annual competency check";

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`e93j-${testInfo.project.name.split("-")[0] ?? "e2e"}`);
    base = `/app/organisations/${world.agencyId}`;
  });

  test("an agency creates, requires and verifies its own requirement", async ({ browser }) => {
    const page = await signedIn(browser, world.admin.email);
    const facility = `${base}/facilities/${world.facilityId}`;
    await page.goto(facility);
    await page.getByRole("link", { name: "Verify now" }).first().click();
    await page.getByLabel("Authentication code").fill(generateTotp(world.admin.totpSecret ?? ""));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(new RegExp(`${facility}$`), AFTER_ACTION);

    // Settings → Compliance: the management surface.
    await page.goto(`${base}/settings/compliance`);
    const panel = page.getByRole("region", { name: "Custom Credential Types" });
    await expect(panel).toContainText("No custom requirements yet.");
    await panel.getByText("+ Add custom requirement").click();
    await panel.getByRole("textbox", { name: "Name" }).fill("Driver License");
    await panel.getByRole("combobox", { name: "Category" }).selectOption({ label: "Other" });
    await panel.getByRole("button", { name: "Create custom requirement" }).click();
    await expect(panel.getByText("Custom requirement created.")).toBeVisible(AFTER_ACTION);
    const table = panel.getByRole("table", { name: "Custom credential types" });
    const row = table.getByRole("row", { name: /Driver License/ });
    await expect(row).toContainText("Other");
    await expect(row).toContainText("Not used yet");
    await expect(row).toContainText("Active");
    // Names are unique per agency (case-insensitive).
    await panel.getByRole("textbox", { name: "Name" }).fill("driver license");
    await panel.getByRole("combobox", { name: "Category" }).selectOption({ label: "Other" });
    await panel.getByRole("button", { name: "Create custom requirement" }).click();
    await expect(
      panel
        .getByRole("alert")
        .filter({ hasText: "A custom requirement with this name already exists." }),
    ).toBeVisible(AFTER_ACTION);
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "e9-3j-settings-custom-types");

    // Compliance: create one inline from the requirement form; it is preselected.
    await page.goto(`${base}/compliance`);
    const credential = page.getByRole("combobox", { name: "Credential" });
    await expect(credential.locator("optgroup[label='Chelth standard']")).toHaveCount(1);
    await expect(
      credential.locator("optgroup[label='Your custom requirements'] option"),
    ).toHaveText(["Driver License"]);
    await credential.selectOption({ label: "+ Create custom requirement" });
    const inline = page.getByRole("region", { name: "Create custom requirement" });
    await inline.getByRole("textbox", { name: "Name" }).fill(inlineName);
    await inline.getByRole("combobox", { name: "Category" }).selectOption({ label: "Competency" });
    await inline
      .getByLabel("Instructions for workers")
      .fill("Upload the signed competency sheet from your unit lead.");
    await expectNoA11yViolations(page);
    await inline.getByRole("button", { name: "Create custom requirement" }).click();
    await expect(inline).toHaveCount(0, AFTER_ACTION);
    await expect(credential).toHaveValue(/^custom_[0-9a-f]{32}$/);
    await expect(credential.locator("option:checked")).toHaveText(inlineName);
    await page.getByLabel("Effective from").fill(isoDate(-1));
    await page.getByRole("button", { name: "Add requirement" }).click();
    await expect(page.getByRole("list", { name: "Agency baseline requirements" })).toContainText(
      inlineName,
      AFTER_ACTION,
    );
    await qaScreenshot(page, "e9-3j-compliance-inline-custom");

    // A facility requirement can use a custom type too.
    await page.goto(facility);
    await page
      .getByRole("combobox", { name: "Credential" })
      .selectOption({ label: "Driver License" });
    await page.getByRole("button", { name: "Add requirement" }).click();
    await expect(page.getByRole("list", { name: /credential requirements$/ })).toContainText(
      "Driver License",
      AFTER_ACTION,
    );

    // Another agency never sees either type.
    const leak = await world.betaAdmin.client
      .from("credential_types")
      .select("name")
      .in("name", ["Driver License", inlineName]);
    expect(leak.data).toEqual([]);

    // The worker adds the new requirement with the agency's instructions, and submits evidence.
    const worker = await signedIn(browser, world.wendy.email);
    await worker.goto(`${base}/my-credentials/new`);
    await worker
      .getByRole("combobox", { name: "Credential type" })
      .selectOption({ label: inlineName });
    await expect(worker.getByRole("note", { name: "Instructions from your agency" })).toHaveText(
      "Upload the signed competency sheet from your unit lead.",
    );
    await expect(worker.getByRole("main")).not.toContainText(/custom/i);
    await expectNoA11yViolations(worker);
    await worker.getByLabel("Expiry date").fill(isoDate(500));
    await worker.getByRole("button", { name: "Save and continue" }).click();
    await expect(worker.getByRole("heading", { level: 1, name: inlineName })).toBeVisible(
      AFTER_ACTION,
    );
    await worker
      .getByTestId("credential-file")
      .setInputFiles({ name: "competency.pdf", mimeType: "application/pdf", buffer: PDF });
    await worker.getByRole("button", { name: "Upload evidence" }).click();
    await expect(worker.getByRole("region", { name: "Evidence" })).toContainText(
      "Checking document…",
      AFTER_ACTION,
    );
    expect(await markUploadsClean(world.wendy.email)).toBeGreaterThanOrEqual(1);
    await worker.reload();
    await worker.getByRole("button", { name: "Submit for review" }).click();
    await expect(worker.getByRole("main").locator("header")).toContainText("Submitted");
    await qaScreenshot(worker, "e9-3j-worker-custom-credential");
    await worker.context().close();

    // The agency verifies it in the normal review screen.
    const [{ data: workers }, { data: credentials }] = await Promise.all([
      world.wendy.client
        .from("agency_workers")
        .select("id")
        .eq("agency_organisation_id", world.agencyId),
      world.wendy.client.from("credentials").select("id, credential_types!inner(name)"),
    ]);
    const workerId = workers?.[0]?.id ?? "";
    const credentialId =
      credentials?.find((row) => row.credential_types.name === inlineName)?.id ?? "";
    await page.goto(`${base}/workforce/${workerId}/credentials/${credentialId}`);
    await expect(page.getByRole("heading", { level: 1, name: inlineName })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole("button", { name: "Record decision" }).click();
    await expect(page.getByText("Decision recorded.")).toBeVisible(AFTER_ACTION);

    // Up to date for the baseline; still blocked at the facility until the Driver License is provided.
    await page.goto(`${base}/workforce/${workerId}`);
    await expect(page.getByRole("region", { name: `${world.agencyName} baseline` })).toContainText(
      "Ready",
    );
    const atFacility = await world.admin.client.rpc("evaluate_worker_compliance", {
      p_agency_worker_id: workerId,
      p_agency_facility_id: world.facilityId,
    });
    expect(
      atFacility.data
        ?.filter((item) => item.reason !== "MET")
        .map((item) => [item.credential_type_name, item.reason]),
    ).toEqual([["Driver License", "MISSING_CREDENTIAL"]]);

    // Settings now shows what uses each type; one in use by an active requirement can't be archived.
    await page.goto(`${base}/settings/compliance`);
    const used = page
      .getByRole("table", { name: "Custom credential types" })
      .getByRole("row", { name: new RegExp(inlineName) });
    await expect(used).toContainText("1 requirement · 1 credential");
    await expect(used.getByRole("button", { name: `Archive ${inlineName}` })).toBeDisabled();
    await page.context().close();
  });
});
