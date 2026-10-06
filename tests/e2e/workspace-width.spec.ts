import { expect, test } from "@playwright/test";

import { createStaffingWorld, type StaffingWorld } from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn } from "./support";

/*
 * Fluid operational workspace (P0-E8 width fix). The sidebar is fixed at
 * 214 px; operational content fills the rest of the viewport with only the
 * locked 30 px / 19 px gutters — no max-width, no centring — at every
 * desktop width, so 1920 px and wider screens use their full width.
 */
const SIDEBAR = 214;
const LEFT_GUTTER = 30;
const RIGHT_GUTTER = 19;

test.describe.serial("fluid operational workspace", () => {
  test.setTimeout(240_000);
  let world: StaffingWorld;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`wide-${testInfo.project.name.split("-")[0] ?? "e2e"}`, [
      { key: "ana", name: "Ana Ortiz", blsExpiryDays: 400 },
    ]);
  });

  test("Workforce and Attendance fill the workspace at large desktop widths", async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name.startsWith("mobile"), "desktop widths only");
    const page = await (await browser.newContext()).newPage();
    await signIn(page, world.admin.email);
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
    for (const [width, height] of [
      [1440, 900],
      [1920, 1080],
      [2560, 1440],
      [3440, 1440],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`/app/organisations/${world.agencyId}/workforce`);
      const table = page.getByRole("region", { name: "Workers table" });
      await expect(table).toBeVisible();
      const box = await table.boundingBox();
      // Starts at the sidebar + left gutter and ends at the right gutter (±2 px borders).
      expect(Math.abs((box?.x ?? 0) - (SIDEBAR + LEFT_GUTTER))).toBeLessThanOrEqual(2);
      expect(
        Math.abs((box?.x ?? 0) + (box?.width ?? 0) - (width - RIGHT_GUTTER)),
      ).toBeLessThanOrEqual(2);
      await expectNoPageOverflow(page);
      await qaScreenshot(page, "wide-workforce");
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/app/organisations/${world.agencyId}/attendance`);
    const summary = await page.getByRole("region", { name: "Attendance summary" }).boundingBox();
    expect(
      Math.abs((summary?.x ?? 0) + (summary?.width ?? 0) - (1920 - RIGHT_GUTTER)),
    ).toBeLessThanOrEqual(2);
    await qaScreenshot(page, "wide-attendance");
    await page.context().close();
  });
});
