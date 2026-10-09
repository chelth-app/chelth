import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import {
  adminWithVerifiedAgency as adminWithVerifiedAgencyShared,
  expectNoPageOverflow,
  openWorkspaceSection,
  PASSWORD,
  qaScreenshot,
  signUpAndConfirm,
  signUpAndConfirmInvitee,
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
    // Locked Workforce: "Add Professional" reveals the existing invite form.
    await page.getByRole("link", { name: "Add Professional" }).click();
    await expect(page.getByRole("heading", { name: "Invite a healthcare worker" })).toBeVisible();
    await page.getByLabel("Worker email address").fill(workerEmail);
    await page.getByRole("button", { name: "Invite worker" }).click();
    // Email delivery is disabled in tests: the link is shown once instead.
    await expect(page.getByText("Email delivery is not configured yet")).toBeVisible();
    const firstInviteUrl = new URL(await page.getByTestId("invite-link").inputValue());
    // P0-E9-3A: the invitation is listed under Pending Invitations (not as a worker).
    await page.reload();
    const pending = page.getByRole("list", { name: "Pending worker invitations" });
    await expect(pending.getByRole("listitem").filter({ hasText: workerEmail })).toContainText(
      "Pending",
    );
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "e93a-pending-invitations");
    // Responsive: no page overflow at any width; touch-sized actions on phones.
    const viewport = page.viewportSize();
    for (const width of [1512, 1280, 1024, 768, 430, 412, 390, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoPageOverflow(page);
      await qaScreenshot(page, "e93a-pending-invitations");
      if (width <= 430) {
        const row = pending.getByRole("listitem").filter({ hasText: workerEmail });
        for (const name of [
          `Resend invitation to ${workerEmail}`,
          `Cancel invite to ${workerEmail}`,
        ]) {
          expect(
            (await row.getByRole("button", { name }).boundingBox())?.height ?? 0,
          ).toBeGreaterThanOrEqual(44);
        }
      }
    }
    if (viewport) await page.setViewportSize(viewport);
    await page.getByRole("link", { name: "Add Professional" }).click();

    // Inviting the same email again while the invitation is pending re-issues it
    // (rotated token, old link dead) instead of failing with a state conflict.
    await page.getByLabel("Worker email address").fill(workerEmail);
    await page.getByRole("button", { name: "Invite worker" }).click();
    await expect(page.getByText("Invitation re-issued for")).toBeVisible();
    await expect(page.getByText("The previous invitation link no longer works.")).toBeVisible();
    await expect(page.getByText("conflicts with the current state")).toHaveCount(0);
    const inviteUrl = new URL(await page.getByTestId("invite-link").inputValue());
    expect(inviteUrl.pathname).not.toBe(firstInviteUrl.pathname);
    await page.reload();
    await expect(
      page
        .getByRole("list", { name: "Pending worker invitations" })
        .getByRole("listitem")
        .filter({ hasText: workerEmail }),
    ).toHaveCount(1);

    // Worker: signed-out landing reveals nothing from the invitation row.
    const workerContext = await browser.newContext();
    const workerPage = await workerContext.newPage();
    await workerPage.goto(inviteUrl.pathname);
    await expect(
      workerPage.getByRole("heading", { name: "You've been invited to join Chelth" }),
    ).toBeVisible();
    await expect(workerPage.getByRole("main")).not.toContainText("Workforce Agency");
    await expect(workerPage.getByRole("main")).not.toContainText(workerEmail);
    await expect(workerPage.getByRole("link", { name: "Create account" })).toBeVisible();
    await expect(workerPage.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in?next=/invite",
    );
    await expectNoA11yViolations(workerPage);
    await qaScreenshot(workerPage, "e93a-invite-landing");

    // Create account → confirm → back to the authenticated review.
    await signUpAndConfirmInvitee(workerPage, "Wren Worker", workerEmail);
    const details = workerPage.locator('[aria-label="Invitation details"]');
    await expect(
      workerPage.getByRole("heading", { name: "Join as a healthcare worker" }),
    ).toBeVisible();
    await expect(details).toContainText("Workforce Agency");
    await expect(details).toContainText("Healthcare Worker");
    await expect(details).toContainText(workerEmail);
    await expectNoA11yViolations(workerPage);
    await qaScreenshot(workerPage, "e93a-invite-review");
    await workerPage.getByRole("button", { name: "Accept invitation" }).click();
    // A new healthcare worker lands in the worker app.
    await expect(workerPage.getByRole("heading", { level: 1, name: "My Shifts" })).toBeVisible();
    await expect(
      workerPage.getByRole("navigation", { name: "Worker" }).getByRole("link", { name: "Shifts" }),
    ).toHaveAttribute("aria-current", "page");

    // Worker self-access: own record, no workforce section, no other workers.
    await workerPage.goto(organisationUrl);
    await expect(workerPage.getByRole("heading", { name: "My worker record" })).toBeVisible();
    await expect(workerPage.getByText("Onboarding")).toBeVisible();
    await expect(workerPage.getByRole("link", { name: "Workforce" })).toHaveCount(0);
    const forbidden = await workerPage.goto(`${organisationUrl}/workforce`);
    expect(forbidden?.status()).toBe(404);

    // Admin: the invitation left Pending; the worker appears in Workforce (Onboarding).
    await page.reload();
    await expect(page.getByText(workerEmail)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Wren Worker" })).toBeVisible();

    // Cancel invite: the token dies immediately and the row leaves Pending.
    const cancelEmail = uniqueEmail("e2e-s3-cancel");
    await page.getByRole("link", { name: "Add Professional" }).click();
    await page.getByLabel("Worker email address").fill(cancelEmail);
    await page.getByRole("button", { name: "Invite worker" }).click();
    await page.reload();
    const cancelRow = page
      .getByRole("list", { name: "Pending worker invitations" })
      .getByRole("listitem")
      .filter({ hasText: cancelEmail });
    await cancelRow.getByRole("button", { name: `Cancel invite to ${cancelEmail}` }).click();
    await expect(page.getByText("Invitation cancelled.")).toBeVisible();
    await qaScreenshot(page, "e93a-invitation-cancelled");
    await page.reload();
    await expect(page.getByText(cancelEmail)).toHaveCount(0);

    // Admin sees and activates the worker.
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

test.describe("worker invitation onboarding (P0-E9-3A)", () => {
  test.setTimeout(180_000);

  test("an existing account signs in from a worker invite and lands in My Shifts; another account is refused", async ({
    page,
    browser,
  }) => {
    await adminWithVerifiedAgency(page, "Onboarding Agency");
    await openWorkspaceSection(page, "Workforce");
    const invite = async (email: string) => {
      await page.getByRole("link", { name: "Add Professional" }).click();
      await page.getByLabel("Worker email address").fill(email);
      await page.getByRole("button", { name: "Invite worker" }).click();
      return new URL(await page.getByTestId("invite-link").inputValue()).pathname;
    };

    // Two people who already use Chelth (no invitation context when they signed up).
    const existingEmail = uniqueEmail("e2e-existing");
    const otherEmail = uniqueEmail("e2e-other");
    for (const [name, email] of [
      ["Esme Existing", existingEmail],
      ["Otis Other", otherEmail],
    ] as const) {
      const context = await browser.newContext();
      await signUpAndConfirm(await context.newPage(), name, email);
      await context.close();
    }
    const existingLink = await invite(existingEmail);

    // Wrong account: the invitation is email-bound and never resolves for another person.
    const otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    await other.goto(existingLink);
    await other.getByRole("link", { name: "Sign in" }).click();
    await other.getByLabel("Email address").fill(otherEmail);
    await other.getByLabel("Password").fill(PASSWORD);
    await other.getByRole("button", { name: "Sign in" }).click();
    await expect(other).toHaveURL(/\/invite$/);
    await expect(other.getByRole("heading", { name: "Invitation unavailable" })).toBeVisible();
    await expect(other.getByRole("main")).not.toContainText("Onboarding Agency");
    await expect(other.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
    await otherContext.close();

    // Existing account: invite → Sign in → resume → review → accept → My Shifts.
    const existingContext = await browser.newContext();
    const existing = await existingContext.newPage();
    await existing.goto(existingLink);
    await existing.getByRole("link", { name: "Sign in" }).click();
    await existing.getByLabel("Email address").fill(existingEmail);
    await existing.getByLabel("Password").fill(PASSWORD);
    await existing.getByRole("button", { name: "Sign in" }).click();
    await expect(existing).toHaveURL(/\/invite$/);
    await expect(existing.locator('[aria-label="Invitation details"]')).toContainText(
      "Onboarding Agency",
    );
    await existing.getByRole("button", { name: "Accept invitation" }).click();
    await expect(existing.getByRole("heading", { level: 1, name: "My Shifts" })).toBeVisible();

    // The used link cannot be replayed.
    await existing.goto(existingLink);
    await expect(existing.getByRole("heading", { name: "Invitation unavailable" })).toBeVisible();
    await existingContext.close();
  });

  test("a new worker onboards from an invite on a phone viewport", async ({ page, browser }) => {
    await adminWithVerifiedAgency(page, "Mobile Onboarding Agency");
    await openWorkspaceSection(page, "Workforce");
    const workerEmail = uniqueEmail("e2e-phone");
    await page.getByRole("link", { name: "Add Professional" }).click();
    await page.getByLabel("Worker email address").fill(workerEmail);
    await page.getByRole("button", { name: "Invite worker" }).click();
    const link = new URL(await page.getByTestId("invite-link").inputValue()).pathname;

    const phone = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const worker = await phone.newPage();
    await worker.goto(link);
    await expect(
      worker.getByRole("heading", { name: "You've been invited to join Chelth" }),
    ).toBeVisible();
    await expectNoPageOverflow(worker);
    await expectNoA11yViolations(worker);
    await qaScreenshot(worker, "e93a-invite-landing");
    const create = worker.getByRole("link", { name: "Create account" });
    expect((await create.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await signUpAndConfirmInvitee(worker, "Pia Phone", workerEmail);
    await expectNoPageOverflow(worker);
    await expectNoA11yViolations(worker);
    await qaScreenshot(worker, "e93a-invite-review");
    await worker.getByRole("button", { name: "Accept invitation" }).click();
    await expect(worker.getByRole("heading", { level: 1, name: "My Shifts" })).toBeVisible();
    await expect(worker.getByRole("navigation", { name: "Worker" })).toBeVisible();
    await phone.close();
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

    // Locked Facilities: "Add Facility" reveals the existing create form.
    await page.getByRole("link", { name: "Add Facility" }).click();
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
