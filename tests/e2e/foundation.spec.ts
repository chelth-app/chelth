import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

function collectPageProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
  });
  return problems;
}

test.describe("foundation smoke", () => {
  test("home page loads without runtime errors or CSP violations", async ({ page }) => {
    const problems = collectPageProblems(page);
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("CHELTH", { exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(problems).toEqual([]);
  });

  test("security headers and a nonce-based CSP are present", async ({ request }) => {
    const first = await request.get("/");
    const second = await request.get("/");
    const csp = first.headers()["content-security-policy"] ?? "";

    expect(csp).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp.split(";").find((d) => d.trim().startsWith("script-src"))).not.toContain(
      "unsafe-inline",
    );
    // A fresh nonce per request.
    expect(second.headers()["content-security-policy"]).not.toBe(csp);

    const headers = first.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("geolocation=(self)");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("health endpoint reveals nothing beyond liveness", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("unknown routes render the not-found page", async ({ page }) => {
    const response = await page.goto("/definitely-not-a-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("invalid email verification links fail safely", async ({ page }) => {
    await page.goto("/auth/confirm?type=magiclink&token_hash=x&next=//evil.example");
    await expect(page).toHaveURL(/\/auth\/error$/);
    await expect(page.getByRole("heading", { name: "We couldn't verify that link" })).toBeVisible();
  });
});

test.describe("accessibility baseline", () => {
  test("home page has no detectable axe violations", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("skip link is the first tab stop and targets main content", async ({ page, isMobile }) => {
    test.skip(isMobile, "Keyboard navigation is verified on desktop.");
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
  });

  test("design-system primitives have no detectable axe violations", async ({ page }) => {
    const problems = collectPageProblems(page);
    await page.goto("/design-system");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("dialog is keyboard-operable and restores focus", async ({ page, isMobile }) => {
    test.skip(isMobile, "Keyboard navigation is verified on desktop.");
    await page.goto("/design-system");
    const opener = page.getByRole("button", { name: "Open dialog" });
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Confirm action" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});
