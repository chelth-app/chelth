import { expect, test } from "@playwright/test";

import { createStaffingWorld, isoDay, type StaffingWorld } from "./staffing-fixture";
import { signIn, SIGNED_IN_LANDING } from "./support";

/*
 * P0-E9-3G: the link in a shift email (/app/organisations/<org>/my-shifts/<assignment>)
 * opens the worker's own shift. It carries no secret: authentication and RLS
 * still decide — another worker gets "Page not found", a signed-out visitor
 * is sent to sign in first.
 */

const AFTER_ACTION = { timeout: 20_000 };

test.describe.serial("shift email deep link (P0-E9-3G)", () => {
  test.setTimeout(240_000);
  let world: StaffingWorld;
  let link: string;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`e93g-${testInfo.project.name.split("-")[0] ?? "e2e"}`, [
      { key: "kim", name: "Kim Assigned", blsExpiryDays: 400 },
    ]);
    const kim = world.extra.kim;
    if (!kim) throw new Error("missing worker");
    const location = await world.admin.client
      .from("facility_locations")
      .select("id")
      .eq("agency_facility_id", world.facilityId)
      .limit(1)
      .single();
    const shift = await world.scheduler.client.rpc("create_shift", {
      p_agency_facility_id: world.facilityId,
      p_facility_location_id: location.data?.id ?? "",
      p_discipline_key: "cna",
      p_shift_date: isoDay(4),
      p_start_time: "07:00",
      p_end_time: "15:00",
      p_requested_headcount: 1,
      p_open: true,
    });
    if (shift.error) throw shift.error;
    const assigned = await world.scheduler.client.rpc("assign_worker_to_shift", {
      p_shift_id: shift.data,
      p_agency_worker_id: kim.workerId,
    });
    if (assigned.error) throw assigned.error;
    link = `/app/organisations/${world.agencyId}/my-shifts/${assigned.data[0]?.assignment_id ?? ""}`;
  });

  test("the assigned worker opens their shift from the email link", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    // Signed out first: sign-in is required before the shift is shown.
    await page.goto(link);
    await expect(page).toHaveURL(/\/sign-in/, AFTER_ACTION);
    await signIn(page, world.extra.kim?.email ?? "");
    await expect(page).toHaveURL(SIGNED_IN_LANDING, AFTER_ACTION);
    await page.goto(link);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Mercy Rehab");
    await page.context().close();
  });

  test("another worker cannot open it", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, world.wendy.email);
    await expect(page).toHaveURL(SIGNED_IN_LANDING, AFTER_ACTION);
    await page.goto(link);
    await expect(page.getByText("Page not found")).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("Kim Assigned");
    await page.context().close();
  });
});
