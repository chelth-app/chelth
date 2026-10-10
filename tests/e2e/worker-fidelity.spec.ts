import { type Browser, expect, type Page, test } from "@playwright/test";

import { agencyWorker, createStaffingWorld, type StaffingWorld } from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn, SIGNED_IN_LANDING } from "./support";

/*
 * P0-E9-3D-S6 canonical worker fidelity walk at 390 × 844 (the reference
 * phone): every worker screen in order, captured for the visual comparison
 * with docs/ui-reference/p08-e8/canonical/Chelth_Worker mobile Flow/ and
 * checked for the app-shell invariants (header, centred column, bottom
 * navigation, no overflow, one h1, actions clear of the bottom bar).
 */

const AFTER_ACTION = { timeout: 20_000 };
const PHONE = { width: 390, height: 844 };

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
  const page = await (await browser.newContext({ viewport: PHONE })).newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(SIGNED_IN_LANDING, AFTER_ACTION);
  return page;
}

async function expectAppShell(page: Page) {
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Worker" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expectNoPageOverflow(page);
  const header = await page.getByRole("banner").boundingBox();
  expect(header?.height ?? 0).toBeLessThanOrEqual(72);
  const nav = await page.getByRole("navigation", { name: "Worker" }).boundingBox();
  expect((nav?.y ?? 0) + (nav?.height ?? 0)).toBeGreaterThanOrEqual(PHONE.height - 1);
}

test.describe.serial("canonical worker fidelity (P0-E9-3D-S6)", () => {
  test.setTimeout(240_000);

  let world: StaffingWorld;
  let base: string;

  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "phone walk (390 × 844)");
  });

  test.beforeAll(async ({}, testInfo) => {
    if (testInfo.project.name !== "mobile-chromium") return;
    testInfo.setTimeout(300_000);
    world = await createStaffingWorld("fid", [
      { key: "fay", name: "Fay Fidelity", blsExpiryDays: 400 },
    ]);
    base = `/app/organisations/${world.agencyId}`;
    const fay = world.extra.fay;
    if (!fay) throw new Error("fixture");
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
    await world.admin.client.rpc("update_facility_worker_context", {
      p_facility_id: world.facilityId,
      p_parking_instructions: "On-site parking is available in the visitor garage.",
      p_arrival_instructions: "Use the east entrance and report to the ward desk.",
      p_worker_contact_label: "Nursing supervisor desk",
      p_worker_contact_phone: "+1 404 555 0187",
    });
    const locations = await world.admin.client
      .from("facility_locations")
      .select("id")
      .eq("agency_facility_id", world.facilityId);
    if (locations.error) throw locations.error;
    const shift = await world.scheduler.client.rpc("create_shift", {
      p_agency_facility_id: world.facilityId,
      p_facility_location_id: locations.data[0]?.id ?? "",
      p_discipline_key: "cna",
      p_shift_date: local(new Date(Date.now() - 5 * 60_000)).date,
      p_start_time: local(new Date(Date.now() - 5 * 60_000)).time,
      p_end_time: local(new Date(Date.now() + 8 * 60 * 60_000)).time,
      p_requested_headcount: 1,
      p_open: true,
    });
    if (shift.error) throw shift.error;
    await world.scheduler.client.rpc("set_shift_unit", {
      p_shift_id: shift.data,
      p_unit_label: "ICU",
    });
    const assigned = await world.scheduler.client.rpc("assign_worker_to_shift", {
      p_shift_id: shift.data,
      p_agency_worker_id: fay.workerId,
    });
    if (assigned.error) throw assigned.error;
    await fay.client.rpc("accept_shift_assignment", {
      p_assignment_id: assigned.data[0]?.assignment_id ?? "",
    });
    // A second agency for the multi-agency chooser.
    await agencyWorker(world, "", "", "beta", fay);
  });

  test("chooser → My Shifts → Shift Details → Check In → Checked In → Timesheet handoff", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.extra.fay?.email ?? "");
    // 12. Multi-agency chooser.
    await expect(page.getByRole("heading", { level: 1, name: "Choose an agency" })).toBeVisible();
    await expectNoPageOverflow(page);
    await qaScreenshot(page, "s6-12-agency-chooser");
    await page.getByRole("link", { name: `Open shifts with ${world.agencyName}` }).click();

    // 1. My Shifts.
    await expect(page).toHaveURL(new RegExp(`${base}/my-shifts$`), AFTER_ACTION);
    await expectAppShell(page);
    await qaScreenshot(page, "s6-01-my-shifts");

    // 2. Shift Details.
    await page
      .getByRole("link", { name: /^Shift details: Mercy Rehab/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Mercy Rehab" })).toBeVisible();
    await expectAppShell(page);
    await qaScreenshot(page, "s6-02-shift-details");

    // 3. Check In.
    const attendance = page.getByRole("region", { name: /^Attendance: / });
    await attendance.scrollIntoViewIfNeeded();
    await qaScreenshot(page, "s6-03-check-in");
    await page.getByRole("button", { name: "Check In at Mercy Rehab" }).click();

    // 4. Checked In / Check Out.
    await expect(attendance).toContainText("Checked in successfully", AFTER_ACTION);
    await attendance.scrollIntoViewIfNeeded();
    await expectAppShell(page);
    await qaScreenshot(page, "s6-04-checked-in");
    await page.getByRole("button", { name: "Check Out at Mercy Rehab" }).click();

    // 5. Timesheet handoff.
    await expect(attendance).toContainText("Worked Time", AFTER_ACTION);
    await attendance.scrollIntoViewIfNeeded();
    await qaScreenshot(page, "s6-05-timesheet-handoff");

    // 11. More.
    await page
      .getByRole("navigation", { name: "Worker" })
      .getByRole("button", { name: /^More/ })
      .click();
    await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
    await qaScreenshot(page, "s6-11-more");
    await page.keyboard.press("Escape");
    await page.context().close();
  });

  test("Messages → Thread; Credentials → Add → Detail", async ({ browser }) => {
    const page = await signedIn(browser, world.extra.fay?.email ?? "");
    await page.goto(`${base}/my-shifts?view=past`);
    await page.goto(`${base}/my-shifts`);
    await page
      .getByRole("link", { name: /^Shift details: Mercy Rehab/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Message agency" }).click();
    await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}$/, AFTER_ACTION);
    await page.getByLabel("Message", { exact: true }).fill("Checked out — thanks for today.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("list", { name: "Messages" })).toContainText(
      "thanks for today",
      AFTER_ACTION,
    );
    const threadUrl = page.url();
    const reply = await world.scheduler.client.rpc("send_message", {
      p_thread_id: threadUrl.split("/").pop() ?? "",
      p_body: "Thank you! Your timesheet is ready to review.",
      p_client_key: crypto.randomUUID(),
    });
    if (reply.error) throw reply.error;

    // 6. Messages.
    await page.goto(`${base}/messages`);
    await expectAppShell(page);
    await qaScreenshot(page, "s6-06-messages");
    // 7. Thread.
    await page.goto(threadUrl);
    await expectAppShell(page);
    await qaScreenshot(page, "s6-07-thread");

    // 8. My Credentials.
    await page.goto(`${base}/my-credentials`);
    await expectAppShell(page);
    await qaScreenshot(page, "s6-08-my-credentials");
    // 9. Add Credential.
    await page.getByRole("link", { name: "Add credential" }).click();
    await expectAppShell(page);
    await qaScreenshot(page, "s6-09-add-credential");
    // 10. Credential detail.
    await page.goto(`${base}/my-credentials`);
    await page
      .getByRole("list", { name: "My credentials" })
      .getByRole("link", { name: /Basic Life Support/ })
      .click();
    await expect(page).toHaveURL(/\/my-credentials\/[0-9a-f-]{36}$/, AFTER_ACTION);
    await expectAppShell(page);
    await qaScreenshot(page, "s6-10-credential-detail");
    await page.context().close();
  });
});
