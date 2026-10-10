import { type Browser, expect, type Page, test } from "@playwright/test";

import { createStaffingWorld, type StaffingWorld } from "./staffing-fixture";
import { signIn, SIGNED_IN_LANDING } from "./support";

/*
 * P0-E9-3D-S7 full worker journey (regression): sign in → My Shifts → Shift
 * Details → Message agency → Directions → Check In → active shift → Check Out
 * → Timesheet → Credentials → Messages → Sign out. Real server state at every
 * step; nothing is claimed before the server confirms it.
 */

const AFTER_ACTION = { timeout: 20_000 };

function local(instant: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(SIGNED_IN_LANDING, AFTER_ACTION);
  return page;
}

test.describe.serial("worker journey (P0-E9-3D-S7)", () => {
  test.setTimeout(240_000);

  let world: StaffingWorld;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(300_000);
    world = await createStaffingWorld(`jrn-${testInfo.project.name.split("-")[0] ?? "e2e"}`, [
      { key: "joy", name: "Joy Journey", blsExpiryDays: 400 },
    ]);
    const joy = world.extra.joy;
    if (!joy) throw new Error("fixture");
    const facility = await world.admin.client
      .from("agency_facilities")
      .select("name, facility_type_key, timezone")
      .eq("id", world.facilityId)
      .single();
    if (facility.error) throw facility.error;
    await world.admin.client.rpc("update_agency_facility", {
      p_facility_id: world.facilityId,
      p_name: facility.data.name,
      p_facility_type: facility.data.facility_type_key,
      p_timezone: facility.data.timezone,
      p_address_line1: "123 Healthway Drive",
      p_locality: "Atlanta",
      p_region: "GA",
      p_postal_code: "30309",
      p_country_code: "US",
    });
    const locations = await world.admin.client
      .from("facility_locations")
      .select("id")
      .eq("agency_facility_id", world.facilityId);
    if (locations.error) throw locations.error;
    const start = local(new Date(Date.now() - 2 * 60_000));
    const end = local(new Date(Date.now() + 6 * 60 * 60_000));
    const shift = await world.scheduler.client.rpc("create_shift", {
      p_agency_facility_id: world.facilityId,
      p_facility_location_id: locations.data[0]?.id ?? "",
      p_discipline_key: "cna",
      p_shift_date: start.date,
      p_start_time: start.time,
      p_end_time: end.time,
      p_requested_headcount: 1,
      p_open: true,
    });
    if (shift.error) throw shift.error;
    const assigned = await world.scheduler.client.rpc("assign_worker_to_shift", {
      p_shift_id: shift.data,
      p_agency_worker_id: joy.workerId,
    });
    if (assigned.error) throw assigned.error;
  });

  test("the full worker journey", async ({ browser }) => {
    const page = await signedIn(browser, world.extra.joy?.email ?? "");
    const base = `/app/organisations/${world.agencyId}`;
    // Sign in lands on My Shifts (worker of one agency).
    await expect(page).toHaveURL(new RegExp(`${base}/my-shifts$`));
    await page.getByRole("button", { name: "Accept shift at Mercy Rehab" }).click();
    await expect(page.getByRole("list", { name: "My assignments" })).toContainText(
      "Accepted",
      AFTER_ACTION,
    );

    // Shift Details.
    await page
      .getByRole("link", { name: /^Shift details: Mercy Rehab/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Mercy Rehab" })).toBeVisible();
    const detail = page.url();

    // Directions: destination only.
    const directions = page.getByRole("link", { name: /^Get directions/ }).first();
    expect(decodeURIComponent((await directions.getAttribute("href")) ?? "")).toContain(
      "123 Healthway Drive",
    );

    // Message agency, then back to the shift through the thread's context.
    await page.getByRole("button", { name: "Message agency" }).click();
    await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}$/, AFTER_ACTION);
    await page.getByLabel("Message", { exact: true }).fill("On my way — arriving in 10.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("list", { name: "Messages" })).toContainText(
      "arriving in 10",
      AFTER_ACTION,
    );
    await page.getByRole("link", { name: /^Shift details: Mercy Rehab/ }).click();
    await expect(page).toHaveURL(detail);

    // Check In → active shift → Check Out.
    const attendance = page.getByRole("region", { name: /^Attendance: / });
    await page.getByRole("button", { name: "Check In at Mercy Rehab" }).click();
    await expect(attendance).toContainText("Checked in successfully", AFTER_ACTION);
    await expect(attendance).toContainText("Current Shift");
    await page.getByRole("button", { name: "Check Out at Mercy Rehab" }).click();
    await expect(attendance).toContainText("Worked Time", AFTER_ACTION);

    // Timesheet handoff → the worker's own weekly timesheet (submission follows the
    // existing weekly rules: an open week cannot be submitted before it ends).
    await attendance
      .getByRole("link", { name: /^(View timesheet|Review and submit timesheet)$/ })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "My timesheet" })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText(/\$\d|pay rate|bill rate/i);

    // Credentials.
    await page
      .getByRole("navigation", { name: "Worker" })
      .getByRole("link", { name: "Credentials" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "My Credentials" })).toBeVisible();

    // Messages (via More).
    await page
      .getByRole("navigation", { name: "Worker" })
      .getByRole("button", { name: /^More/ })
      .click();
    await page
      .getByRole("dialog", { name: "More" })
      .getByRole("link", { name: /Messages/ })
      .click();
    await expect(page.getByRole("list", { name: "Message threads" })).toContainText(
      "arriving in 10",
    );

    // Sign out.
    await page
      .getByRole("navigation", { name: "Worker" })
      .getByRole("button", { name: /^More/ })
      .click();
    await page
      .getByRole("dialog", { name: "More" })
      .getByRole("button", { name: "Sign out" })
      .click();
    await expect(page).toHaveURL(/\/sign-in$/, AFTER_ACTION);
    expect((await page.goto(`${base}/messages`))?.url()).toMatch(/\/sign-in/);
    await page.context().close();
  });
});
