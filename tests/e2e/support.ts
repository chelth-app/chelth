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
