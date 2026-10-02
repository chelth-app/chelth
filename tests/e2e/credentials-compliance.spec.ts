import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { markUploadsClean } from "../support/scanner";
import {
  adminWithVerifiedAgency,
  expectNoPageOverflow,
  openWorkspaceSection,
  qaScreenshot,
  signUpAndConfirm,
  uniqueEmail,
} from "./support";

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const PDF = Buffer.from("%PDF-1.4\n% Chelth E2E credential evidence\n%%EOF\n");

function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
  expect(results.violations).toEqual([]);
  // P0-E8-S2: wide tables scroll inside their region, never the page (412 px on mobile).
  await expectNoPageOverflow(page);
}

test.describe("credentials and compliance", () => {
  test.setTimeout(240_000);

  test("worker submits evidence; agency verifies; readiness is derived and explained", async ({
    page,
    browser,
  }) => {
    const organisationPath = await adminWithVerifiedAgency(page, "Compliance Agency");

    // Agency baseline: BLS for everyone.
    await openWorkspaceSection(page, "Compliance");
    await page
      .getByRole("combobox", { name: "Credential" })
      .selectOption({ label: "Basic Life Support (BLS)" });
    // Agency-wide requirements have no timezone default: the date is chosen explicitly.
    await page.getByLabel("Effective from").fill(isoDate(-1));
    await page.getByRole("button", { name: "Add requirement" }).click();
    await expect(page.getByRole("list", { name: "Agency baseline requirements" })).toContainText(
      "Basic Life Support (BLS)",
    );
    await expectNoA11yViolations(page);

    // A client facility that additionally requires orientation.
    await page.goto(`${organisationPath}/facilities`);
    await page.getByLabel("Facility name").fill("Mercy Rehab");
    await page
      .getByRole("combobox", { name: "Facility type" })
      .selectOption({ label: "Rehabilitation" });
    await page
      .getByRole("combobox", { name: "Timezone", exact: true })
      .selectOption("America/New_York");
    await page.getByRole("button", { name: "Create facility" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Mercy Rehab" })).toBeVisible();
    await page
      .getByRole("combobox", { name: "Credential" })
      .selectOption({ label: "Facility orientation" });
    await page.getByRole("button", { name: "Add requirement" }).click();
    await expect(
      page.getByRole("list", { name: "Mercy Rehab credential requirements" }),
    ).toContainText("Facility orientation");

    // Invite and activate a worker.
    await page.goto(`${organisationPath}/workforce`);
    const workerEmail = uniqueEmail("e2e-cred-worker");
    await page.getByLabel("Worker email address").fill(workerEmail);
    await page.getByRole("button", { name: "Invite worker" }).click();
    const inviteUrl = new URL(await page.getByTestId("invite-link").inputValue());

    const workerContext = await browser.newContext();
    const worker = await workerContext.newPage();
    await worker.goto(inviteUrl.pathname);
    await signUpAndConfirm(worker, "Jane Williams", workerEmail);
    await worker.getByRole("link", { name: "Review invitation" }).click();
    await worker.getByRole("button", { name: "Accept invitation" }).click();
    await expect(
      worker.getByRole("heading", { level: 1, name: "Compliance Agency" }),
    ).toBeVisible();

    await page.reload();
    await page.getByRole("link", { name: "Jane Williams" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Jane Williams" })).toBeVisible();
    const workerPath = new URL(page.url()).pathname;
    await page.getByRole("button", { name: "Set active" }).click();
    await expect(page.getByRole("region", { name: "Compliance Agency baseline" })).toContainText(
      "Missing",
    );

    // Worker adds BLS, uploads evidence, and submits it.
    await worker.getByRole("link", { name: "My credentials" }).click();
    await expect(worker.getByText("Not eligible")).toBeVisible();
    await expectNoA11yViolations(worker);
    await worker
      .getByRole("combobox", { name: "Credential" })
      .selectOption({ label: "Basic Life Support (BLS)" });
    await worker.getByLabel("Issue date").fill(isoDate(-30));
    await worker.getByLabel("Expiry date").fill(isoDate(700));
    await worker.getByRole("button", { name: "Add credential" }).click();
    await expect(
      worker.getByRole("heading", { level: 1, name: "Basic Life Support (BLS)" }),
    ).toBeVisible();
    await expect(worker.getByText("Shared", { exact: true })).toBeVisible();

    await worker
      .getByTestId("credential-file")
      .setInputFiles({ name: "bls.pdf", mimeType: "application/pdf", buffer: PDF });
    await worker.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(worker.getByText("will be usable once its security scan clears")).toBeVisible();
    await expect(worker.getByText("Awaiting security scan")).toBeVisible();
    await qaScreenshot(worker, "s6-credential-upload");

    // Wrong content is refused server-side even with a PDF name and type.
    await worker.getByTestId("credential-file").setInputFiles({
      name: "fake.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("<html><script>alert(1)</script></html>"),
    });
    await worker.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(worker.getByRole("alert").filter({ hasText: "does not match" })).toBeVisible();

    expect(await markUploadsClean(workerEmail)).toBe(1);
    await worker.getByRole("button", { name: "Submit for review" }).click();
    await expect(worker.getByText("Submitted")).toBeVisible();

    // Agency sees awaiting verification, reviews the document, verifies.
    await page.goto(workerPath);
    await expect(page.getByText("Awaiting verification")).toBeVisible();
    await page.getByRole("link", { name: /Basic Life Support/ }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Basic Life Support (BLS)" }),
    ).toBeVisible();
    const reviewPath = new URL(page.url()).pathname;
    await expectNoA11yViolations(page);
    // The audited gate mints a short-lived signed URL; the browser fetches the file from it.
    const [signedResponse] = await Promise.all([
      page.waitForResponse(/\/storage\/v1\/object\/sign\/credential-documents\//),
      page.getByRole("button", { name: "Open document 1 of version 1" }).click(),
    ]);
    expect(signedResponse.status()).toBe(200);
    // Headless Chromium handles the PDF as a download; start the next step from a fresh page.
    await page.goto(reviewPath);
    await page.getByRole("button", { name: "Record decision" }).click();
    await expect(page.getByText("Decision recorded.")).toBeVisible();

    // Worker sees the verified state.
    await worker.reload();
    await expect(worker.getByRole("list").filter({ hasText: "Compliance Agency" })).toContainText(
      "Verified",
    );

    // Baseline ready; Mercy still requires orientation.
    await page.goto(workerPath);
    await expect(page.getByRole("region", { name: "Compliance Agency baseline" })).toContainText(
      "Ready",
    );
    await page.getByLabel("Check readiness for a facility").selectOption({ label: "Mercy Rehab" });
    await page.getByRole("button", { name: "Check" }).click();
    const mercy = page.getByRole("region", { name: "Mercy Rehab" });
    await expect(mercy).toContainText("Not eligible");
    await expect(mercy).toContainText("Facility orientation");

    // The worker cannot use the agency review route for their own credential.
    const forbidden = await worker.goto(reviewPath);
    expect(forbidden?.status()).toBe(404);
    await workerContext.close();
  });

  test("another tenant cannot reach credential and compliance routes", async ({
    page,
    browser,
  }) => {
    const organisationPath = await adminWithVerifiedAgency(page, "Private Agency");
    const outsiderContext = await browser.newContext();
    const outsider = await outsiderContext.newPage();
    await signUpAndConfirm(outsider, "Otto Outsider", uniqueEmail("e2e-cred-outsider"));
    for (const path of [
      `${organisationPath}/compliance`,
      `${organisationPath}/my-credentials`,
      `${organisationPath}/workforce/00000000-0000-4000-8000-000000000000/credentials/00000000-0000-4000-8000-000000000000`,
    ]) {
      const response = await outsider.goto(path);
      expect(response?.status(), path).toBe(404);
    }
    await outsiderContext.close();
  });
});
