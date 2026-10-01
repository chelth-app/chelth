import { expect, type Page, test } from "@playwright/test";

import { formatCalendarDate, localCalendarDate } from "@/lib/domain/credentials";

import { generateTotp } from "../support/totp";
import { createStaffingWorld, type StaffingWorld } from "./staffing-fixture";
import { signIn } from "./support";

const AFTER_ACTION = { timeout: 20_000 };
const TZ = "America/Chicago";

async function must<T>(promise: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await promise;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("no data");
  return data;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

test.describe.serial("local-date requirement effectiveness", () => {
  test.setTimeout(240_000);
  let world: StaffingWorld;
  let facilityId: string;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`ld-${testInfo.project.name.split("-")[0] ?? "e2e"}`);
    facilityId = await must(
      world.admin.client.rpc("create_agency_facility", {
        p_agency_organisation_id: world.agencyId,
        p_name: "Lakeview Clinic",
        p_facility_type: "clinic",
        p_timezone: TZ,
      }),
    );
  });

  test("a facility requirement shows its local effective date and applies from it", async ({
    browser,
  }) => {
    const page: Page = await (await browser.newContext()).newPage();
    await signIn(page, world.admin.email);
    await expect(page).toHaveURL(/\/app$/, AFTER_ACTION);
    const path = `/app/organisations/${world.agencyId}/facilities/${facilityId}`;
    await page.goto(path);
    await page.getByRole("link", { name: "Verify now" }).first().click();
    await page.getByLabel("Authentication code").fill(generateTotp(world.admin.totpSecret ?? ""));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`), AFTER_ACTION);

    // The date is visible, explicit and defaults to the facility's local date.
    const effective = page.getByLabel("Effective from");
    const shown = await effective.inputValue();
    const localToday = localCalendarDate(TZ);
    expect([localToday, localCalendarDate(TZ, new Date(Date.now() - 5_000))]).toContain(shown);
    await expect(page.getByText(`Defaults to today at Lakeview Clinic (${TZ}).`)).toBeVisible();

    await page.getByRole("combobox", { name: "Credential" }).selectOption("facility_orientation");
    await page.getByRole("button", { name: "Add requirement" }).click();
    const list = page.getByRole("list", { name: "Lakeview Clinic credential requirements" });
    await expect(list).toContainText(`From ${formatCalendarDate(shown)}`, AFTER_ACTION);
    await page.context().close();

    // Readiness reflects it on the expected local date, and not the day before.
    const [wendyRecord] = await must(
      world.wendy.client
        .from("agency_workers")
        .select("id")
        .eq("agency_organisation_id", world.agencyId),
    );
    const wendyWorkerId = wendyRecord?.id ?? "";
    const on = await must(
      world.admin.client.rpc("worker_readiness", {
        p_agency_worker_id: wendyWorkerId,
        p_agency_facility_id: facilityId,
        p_as_of: shown,
      }),
    );
    const before = await must(
      world.admin.client.rpc("worker_readiness", {
        p_agency_worker_id: wendyWorkerId,
        p_agency_facility_id: facilityId,
        p_as_of: addDays(shown, -1),
      }),
    );
    expect(on[0]?.readiness).not.toBe("ready");
    expect(before[0]?.readiness).toBe("ready");
  });
});
