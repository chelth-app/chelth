import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import { createStaffingWorld, type StaffingWorld } from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn } from "./support";

/*
 * P0-E8-S7 auth + system states (P9): one canvas for every auth surface,
 * system states inside the frame that owns the route, and tenant-safe 404s.
 */

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const WIDTHS = [375, 390, 412, 430, 768, 1024, 1280, 1512];
const RANDOM_ORG = "00000000-0000-4000-8000-000000000000";

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
  expect(results.violations).toEqual([]);
  await expectNoPageOverflow(page);
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  return page;
}

test.describe("auth canvas", () => {
  const surfaces = [
    { path: "/sign-in", heading: "Sign in", shot: "s7-sign-in" },
    { path: "/sign-up", heading: "Create your account", shot: "s7-sign-up" },
    { path: "/forgot-password", heading: "Reset your password", shot: "s7-forgot-password" },
    { path: "/reset-password", heading: "Choose a new password", shot: "s7-reset-password" },
    { path: "/invite", heading: "You have been invited to CHELTH", shot: "s7-invite" },
    { path: "/auth/error", heading: "We couldn't verify that link", shot: "s7-auth-error" },
  ];

  for (const surface of surfaces) {
    test(`${surface.path}: canonical logo, one h1, centred card, safe at every width`, async ({
      page,
    }) => {
      await page.goto(surface.path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(surface.heading);
      await expect(page.getByRole("main").getByRole("img", { name: /Chelth/ })).toHaveAttribute(
        "src",
        "/brand/chelth/logo-primary.svg",
      );
      await qaScreenshot(page, surface.shot);
      await expectNoA11yViolations(page);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        await expectNoPageOverflow(page);
      }
    });
  }

  test("sign-in controls keep 44 px targets and labelled fields", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    for (const control of [
      page.getByRole("button", { name: "Sign in" }),
      page.getByRole("link", { name: "Forgotten your password?" }),
      page.getByRole("link", { name: "Create an account" }),
    ]) {
      const box = await control.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test("password fields: accessible show / hide that never submits (P0-E8-A1.2)", async ({
    page,
  }) => {
    for (const [path, autocomplete] of [
      ["/sign-in", "current-password"],
      ["/sign-up", "new-password"],
    ] as const) {
      await page.goto(path);
      const field = page.getByRole("textbox", { name: "Password", exact: true });
      await expect(field).toHaveAttribute("type", "password");
      await expect(field).toHaveAttribute("autocomplete", autocomplete);
      await field.fill("Fixture-Passw0rd-1");
      const show = page.getByRole("button", { name: "Show password" });
      expect((await show.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await show.click();
      await expect(field).toHaveAttribute("type", "text");
      await expect(field).toHaveValue("Fixture-Passw0rd-1");
      await expect(page).toHaveURL(new RegExp(`${path}$`)); // not submitted
      // No form submission: no form alert in the page content (Next's route announcer aside).
      await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
      // Keyboard: the toggle is reachable and operable; the label reflects the state.
      const hide = page.getByRole("button", { name: "Hide password" });
      await hide.focus();
      await page.keyboard.press("Enter");
      await expect(field).toHaveAttribute("type", "password");
      await expect(page.getByRole("button", { name: "Show password" })).toBeFocused();
      await expect(field).toHaveAttribute("autocomplete", autocomplete);
      await qaScreenshot(page, `a12-password${path.replace("/", "-")}`);
      await expectNoA11yViolations(page);
    }
  });

  test("unmatched routes: 404 on the canvas", async ({ page }) => {
    const response = await page.goto("/definitely-not-a-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    // One safe destination; no technical detail.
    await expect(page.getByRole("link", { name: "Return home" })).toHaveAttribute("href", "/");
    await expect(page.getByRole("main")).not.toContainText(/stack|digest|supabase|error code/i);
    await qaScreenshot(page, "a1-not-found");
    await expectNoA11yViolations(page);
  });

  test("sign in: validation and incorrect credentials are announced in plain language (P0-E8-A1)", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Sign in" }).click();
    // Native/field validation keeps the user on the form; nothing is submitted.
    await expect(page).toHaveURL(/\/sign-in/);
    await page.getByLabel("Email address").fill("nobody@example.test");
    await page.getByLabel("Password").fill("not-the-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "incorrect" });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    // Calm wording; no provider internals or error codes.
    await expect(page.getByRole("main")).not.toContainText(
      /AuthApiError|supabase|status 4\d\d|oops/i,
    );
    await qaScreenshot(page, "a1-sign-in-error");
    await expectNoA11yViolations(page);
  });
});

test.describe.serial("system states render in the owning frame", () => {
  test.setTimeout(240_000);
  let world: StaffingWorld;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`ss-${testInfo.project.name.split("-")[0] ?? "e2e"}`);
  });

  test("workspace staff: 404 inside the workspace shell, status preserved", async ({ browser }) => {
    const page = await signedIn(browser, world.scheduler.email);
    const response = await page.goto(`/app/organisations/${world.agencyId}/payroll`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    // Inside the shell: the workspace header/user control stays available.
    await expect(page.getByRole("button", { name: /Account and workspace menu/ })).toBeVisible();
    await qaScreenshot(page, "s7-workspace-not-found");
    await expectNoA11yViolations(page);
    await page.context().close();
  });

  test("worker: 404 inside the worker shell", async ({ browser }) => {
    const page = await signedIn(browser, world.wendy.email);
    const response = await page.goto(`/app/organisations/${world.agencyId}/payroll`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Worker" })).toBeVisible();
    await qaScreenshot(page, "s7-worker-not-found");
    await expectNoA11yViolations(page);
    await page.context().close();
  });

  test("tenant-safe: another tenant's organisation looks exactly like one that does not exist", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.scheduler.email);
    const texts: string[] = [];
    for (const organisationId of [world.betaId, RANDOM_ORG]) {
      const response = await page.goto(`/app/organisations/${organisationId}`);
      expect(response?.status(), organisationId).toBe(404);
      texts.push((await page.getByRole("main").innerText()).trim());
    }
    expect(texts[0]).toBe(texts[1]);
    expect(texts[0]).not.toMatch(/permission|access denied|forbidden|Beta Agency/i);
    await page.context().close();
  });

  test("MFA verify: P6 card in the personal frame, with the existing set-up path", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.scheduler.email);
    await page.goto(`/app/security/verify?next=/app`);
    await expect(page.getByRole("heading", { level: 1, name: "Verify it's you" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Account" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Set one up" })).toHaveAttribute(
      "href",
      /\/app\/security\?next=/,
    );
    await qaScreenshot(page, "s7-mfa-verify-no-factor");
    await expectNoA11yViolations(page);
    await page.context().close();
  });

  test("error and not-found reference states", async ({ page }) => {
    await page.goto("/design-system");
    const section = page.getByRole("region", { name: "System states (P0-E8-S7)" });
    await expect(section.getByRole("alert")).toContainText("Reference: ref-123");
    await section.scrollIntoViewIfNeeded();
    await qaScreenshot(page, "s7-error-states");
  });
});
