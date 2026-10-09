import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  createAgency,
  enrolAuthenticator,
  followEmailLink,
  PASSWORD,
  qaScreenshot,
  signIn,
  signUp,
  signUpAndConfirm,
  signUpAndConfirmInvitee,
  uniqueEmail,
} from "./support";
import { waitForEmailLink } from "../support/mailpit";

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];

test.describe("authentication", () => {
  test("protected routes redirect to sign-in", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp$/);
    await page.goto("/app/organisations/00000000-0000-4000-8000-000000000000");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("authentication pages are accessible", async ({ page }) => {
    for (const path of ["/sign-in", "/sign-up", "/forgot-password"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
      expect(results.violations, path).toEqual([]);
    }
  });

  test("sign-up → verify email → create agency → sign out → sign in", async ({ page }) => {
    const email = uniqueEmail("e2e-signup");
    await signUpAndConfirm(page, "Sam Signup", email);
    await expect(page.getByRole("heading", { name: "Welcome, Sam Signup" })).toBeVisible();
    await expect(page.getByText("You are not a member of any organisation yet.")).toBeVisible();

    await createAgency(page, "Signup Agency");
    await expect(page.getByRole("banner").getByText("Agency Admin", { exact: true })).toBeVisible();
    // Privileged capabilities need step-up at AAL1.
    await expect(page.getByRole("note")).toContainText(
      "requires verification with your authenticator app",
    );
    const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect(results.violations).toEqual([]);

    // In the workspace shell, Sign out lives in the account and workspace menu.
    await page.getByRole("button", { name: /Account and workspace menu/ }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    // Sign-out still returns to "/", which (P0-E8-A1.1) sends signed-out visitors to Sign in.
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/sign-in/);

    await signIn(page, email);
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("button", { name: "Open workspace Signup Agency" })).toBeVisible();
  });

  test("wrong credentials get a uniform error", async ({ page }) => {
    await signIn(page, uniqueEmail("nobody"), "Wrong-Passw0rd-123");
    await expect(
      page.getByRole("alert").filter({ hasText: "email address or password is incorrect" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("password reset: uniform request → email link → new password → sign in", async ({
    page,
  }) => {
    // Unknown email: same confirmation as a known one (no account enumeration).
    await page.goto("/forgot-password");
    await page.getByLabel("Email address").fill(uniqueEmail("unknown"));
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText("If an account exists");

    const email = uniqueEmail("e2e-reset");
    await signUpAndConfirm(page, "Rae Reset", email);
    await page.getByRole("button", { name: "Sign out" }).click();

    const requestedAt = new Date(Date.now() - 1000);
    await page.goto("/forgot-password");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText("If an account exists");

    await followEmailLink(page, email, "Reset your CHELTH password", requestedAt);
    await expect(page).toHaveURL(/\/reset-password$/);
    const newPassword = "Brand-New-Passw0rd-9";
    await page.getByRole("textbox", { name: "New password", exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password").fill(newPassword);
    // P0-E8-A1.2: each password field has its own show / hide control (presentation only).
    const newField = page.getByRole("textbox", { name: "New password", exact: true });
    const confirmField = page.getByLabel("Confirm new password");
    await expect(newField).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show new password" }).click();
    await expect(newField).toHaveAttribute("type", "text");
    await expect(newField).toHaveValue(newPassword);
    await expect(confirmField).toHaveAttribute("type", "password");
    await expect(page.getByRole("button", { name: "Hide new password" })).toBeVisible();
    await page.getByRole("button", { name: "Show confirm password" }).click();
    await expect(confirmField).toHaveAttribute("type", "text");
    await expect(newField).toHaveAttribute("autocomplete", "new-password");
    await expect(confirmField).toHaveAttribute("autocomplete", "new-password");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByRole("status")).toContainText("Your password has been updated");

    await page.getByRole("button", { name: "Sign out" }).click();
    await signIn(page, email, PASSWORD);
    await expect(page.getByRole("alert").filter({ hasText: "incorrect" })).toBeVisible();
    await signIn(page, email, newPassword);
    await expect(page).toHaveURL(/\/app$/);
  });

  test("hosted-style recovery link without `next` still opens the reset form", async ({ page }) => {
    const email = uniqueEmail("e2e-hosted-reset");
    await signUpAndConfirm(page, "Hal Hosted", email);
    await page.getByRole("button", { name: "Sign out" }).click();

    const requestedAt = new Date(Date.now() - 1000);
    await page.goto("/forgot-password");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText("If an account exists");

    // Simulate a hosted template that dropped `&next=/reset-password`.
    const link = await waitForEmailLink(email, "Reset your CHELTH password", {
      after: requestedAt,
    });
    link.searchParams.delete("next");
    expect(link.searchParams.get("type")).toBe("recovery");
    await page.goto(`${link.pathname}${link.search}`);

    await expect(page).toHaveURL(/\/reset-password$/);
    const newPassword = "Hosted-Style-Passw0rd-7";
    await page.getByRole("textbox", { name: "New password", exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password").fill(newPassword);
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByRole("status")).toContainText("Your password has been updated");
  });

  test("a used recovery link cannot open the reset form again", async ({ page }) => {
    const email = uniqueEmail("e2e-reset-replay");
    await signUpAndConfirm(page, "Rory Replay", email);
    await page.getByRole("button", { name: "Sign out" }).click();

    const requestedAt = new Date(Date.now() - 1000);
    await page.goto("/forgot-password");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText("If an account exists");
    const link = await waitForEmailLink(email, "Reset your CHELTH password", {
      after: requestedAt,
    });

    await page.goto(`${link.pathname}${link.search}`);
    await expect(page).toHaveURL(/\/reset-password$/);
    // Drop the recovery session: a replayed token must not create a new one.
    await page.context().clearCookies();

    await page.goto(`${link.pathname}${link.search}`);
    await expect(page).toHaveURL(/\/auth\/error$/);
  });

  test("reset page without a recovery session explains the link is needed", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: "Reset link required" })).toBeVisible();
  });

  test("a new account is unverified until the email link is used", async ({ page }) => {
    const email = uniqueEmail("e2e-unverified");
    await signUp(page, "Una Verified", email);
    await signIn(page, email);
    await expect(page.getByRole("alert").filter({ hasText: "verify your email" })).toBeVisible();
  });
});

test.describe("organisation access", () => {
  // Long flow: admin enables MFA, invites; invitee signs up and accepts.
  test.setTimeout(120_000);

  test("MFA step-up → invite → invitee signs up and joins with the invited role", async ({
    page,
    browser,
  }) => {
    const adminEmail = uniqueEmail("e2e-admin");
    await signUpAndConfirm(page, "Ada Admin", adminEmail);
    await createAgency(page, "Invite Flow Agency");
    const organisationUrl = page.url();

    // Step-up path: no authenticator yet → set one up → return to the organisation.
    await page.getByRole("link", { name: "Verify now" }).click();
    await page.getByRole("link", { name: "Set one up" }).click();
    await enrolAuthenticator(page);
    await expect(page).toHaveURL(organisationUrl);
    await expect(page.getByRole("note")).toHaveCount(0);

    // Invite (the role list is limited to the admin's ceiling; DB enforces it).
    // P0-E8-S9H: invitations live in Settings → Team & Permissions.
    await page.goto(`${organisationUrl.replace(/\/$/, "")}/settings/team`);
    const inviteeEmail = uniqueEmail("e2e-invitee");
    await page.getByLabel("Email address").fill(inviteeEmail);
    await page
      .getByRole("combobox", { name: "Role", exact: true })
      .selectOption({ label: "Scheduler" });
    await page.getByRole("button", { name: "Create invitation" }).click();
    const inviteUrl = new URL(await page.getByTestId("invite-link").inputValue());
    await expect(page.getByRole("listitem").filter({ hasText: inviteeEmail })).toBeVisible();

    // Invitee, in a separate browser context.
    const inviteeContext = await browser.newContext();
    const invitee = await inviteeContext.newPage();
    await invitee.goto(inviteUrl.pathname);
    await expect(invitee).toHaveURL(/\/invite$/);
    await expect(
      invitee.getByRole("heading", { name: "You've been invited to join Chelth" }),
    ).toBeVisible();

    await signUpAndConfirmInvitee(invitee, "Ivy Invitee", inviteeEmail);
    await expect(invitee.getByText("Invite Flow Agency").first()).toBeVisible();
    await qaScreenshot(invitee, "s7-invite-preview");
    await invitee.getByRole("button", { name: "Accept invitation" }).click();
    await expect(
      invitee.getByRole("heading", { level: 1, name: "Operations Overview" }),
    ).toBeVisible();
    await expect(invitee.getByRole("banner")).toContainText("Invite Flow Agency");
    await expect(invitee.getByText("Scheduler").first()).toBeVisible();

    // Replaying the same link after acceptance gives the uniform invalid message.
    await invitee.goto(inviteUrl.pathname);
    await expect(invitee.getByRole("heading", { name: "Invitation unavailable" })).toBeVisible();

    // The admin sees the new member.
    await page.reload();
    await expect(page.getByRole("rowheader", { name: "Ivy Invitee" })).toBeVisible();
    await inviteeContext.close();
  });

  test("organisation pages of other tenants are not found", async ({ page }) => {
    await signUpAndConfirm(page, "Otto Outsider", uniqueEmail("e2e-outsider"));
    const response = await page.goto("/app/organisations/00000000-0000-4000-8000-000000000000");
    expect(response?.status()).toBe(404);
    const malformed = await page.goto("/app/organisations/not-a-uuid");
    expect(malformed?.status()).toBe(404);
  });
});
