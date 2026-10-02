import { expect, type Page } from "@playwright/test";

import { uniqueEmail, waitForEmailLink } from "../support/mailpit";
import { generateTotp } from "../support/totp";

export const PASSWORD = "E2e-Test-Passw0rd-1";

export { uniqueEmail };

/**
 * Follows an auth email link captured by local Mailpit. The email points at
 * the configured site URL; the test re-targets the path at the app under test.
 */
export async function followEmailLink(
  page: Page,
  email: string,
  subject: string,
  after?: Date,
): Promise<void> {
  const link = await waitForEmailLink(email, subject, after ? { after } : {});
  await page.goto(`${link.pathname}${link.search}`);
}

export async function signUp(page: Page, name: string, email: string): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
}

export async function signUpAndConfirm(page: Page, name: string, email: string): Promise<void> {
  await signUp(page, name, email);
  await followEmailLink(page, email, "Confirm your CHELTH account");
  await expect(page).toHaveURL(/\/app$/);
}

export async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function createAgency(page: Page, name: string): Promise<void> {
  await page.getByLabel("Agency name").fill(name);
  await page.getByRole("button", { name: "Create agency" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

/** Enrols TOTP through the Security page UI; returns the secret. */
export async function enrolAuthenticator(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim() ?? "";
  expect(secret).not.toBe("");
  await page.getByLabel("Authentication code").fill(generateTotp(secret));
  await page.getByRole("button", { name: "Confirm and enable" }).click();
  return secret;
}

/** Admin with a new agency and an AAL2 session (via the real step-up path). Returns the org path. */
export async function adminWithVerifiedAgency(
  page: Page,
  agencyName: string,
  email = uniqueEmail("e2e-admin"),
): Promise<string> {
  await signUpAndConfirm(page, "Ada Admin", email);
  await createAgency(page, agencyName);
  const organisationPath = new URL(page.url()).pathname;
  await page.getByRole("link", { name: "Verify now" }).click();
  await page.getByRole("link", { name: "Set one up" }).click();
  await enrolAuthenticator(page);
  // Enrolment + AAL2 refresh can be slow when the suite runs fully parallel.
  await expect(page).toHaveURL(new RegExp(`${organisationPath}$`), { timeout: 20_000 });
  return organisationPath;
}

/**
 * Opens a workspace section from the shell's sidebar navigation (P0-E8-S1):
 * the persistent sidebar on desktop, or the overlay from "Open navigation" on
 * narrow viewports.
 */
export async function openWorkspaceSection(page: Page, name: string): Promise<void> {
  const trigger = page.getByRole("button", { name: "Open navigation" });
  if (await trigger.isVisible()) {
    await trigger.click();
    await page
      .getByRole("dialog", { name: "Workspace navigation" })
      .getByRole("link", { name, exact: true })
      .click();
    return;
  }
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name, exact: true })
    .click();
}

/** The page itself never scrolls horizontally: wide tables scroll inside their region. */
export async function expectNoPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `page-level horizontal overflow on ${page.url()}`).toBeLessThanOrEqual(0);
}

/** Visual QA capture, only when QA_SCREENSHOTS_DIR is set (never in CI by default). */
export async function qaScreenshot(page: Page, name: string): Promise<void> {
  const dir = process.env.QA_SCREENSHOTS_DIR;
  if (!dir) return;
  const width = page.viewportSize()?.width ?? 0;
  await page.screenshot({ path: `${dir}/${width}px-${name}.png` });
}
