import AxeBuilder from "@axe-core/playwright";
import { deflateSync } from "node:zlib";

import { type Browser, expect, type Page, test } from "@playwright/test";

import { generateTotp } from "../support/totp";
import {
  arrangePastWork,
  createStaffingWorld,
  isoDay,
  type StaffingWorld,
} from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn, SIGNED_IN_LANDING } from "./support";

/*
 * P0-E9-3D-S2 shift context: the agency sets arrival guidance, a worker-facing
 * role / desk contact, a unit and a facility photo; the worker sees them on
 * Today / Upcoming / Past and Shift Details only while the assignment is
 * active. Directions are destination-only; site contacts never leak.
 */

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const AFTER_ACTION = { timeout: 20_000 };
/** A real, decodable 64 × 40 PNG (a soft teal block) built at runtime. */
function syntheticPng(width = 64, height = 40): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0)]);
  for (let x = 0; x < width; x += 1) row.set([0x9f, 0xdc, 0xcf], 1 + x * 3);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const PNG = syntheticPng();

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
  expect(results.violations).toEqual([]);
  await expectNoPageOverflow(page);
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(SIGNED_IN_LANDING, AFTER_ACTION);
  return page;
}

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

test.describe.serial("worker shift context (P0-E9-3D-S2)", () => {
  test.setTimeout(240_000);

  let world: StaffingWorld;
  let locationId: string;
  let todayShift: string;
  let base: string;

  async function shiftFor(
    workerId: string,
    start: { date: string; time: string },
    end: { date: string; time: string },
  ): Promise<{ shiftId: string; assignmentId: string }> {
    const shift = await world.scheduler.client.rpc("create_shift", {
      p_agency_facility_id: world.facilityId,
      p_facility_location_id: locationId,
      p_discipline_key: "cna",
      p_shift_date: start.date,
      p_start_time: start.time,
      p_end_time: end.time,
      p_requested_headcount: 2,
      p_open: true,
    });
    if (shift.error) throw shift.error;
    const decision = await world.scheduler.client.rpc("assign_worker_to_shift", {
      p_shift_id: shift.data,
      p_agency_worker_id: workerId,
    });
    if (decision.error) throw decision.error;
    return { shiftId: shift.data, assignmentId: decision.data[0]?.assignment_id ?? "" };
  }

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(300_000);
    world = await createStaffingWorld(`ctx-${testInfo.project.name.split("-")[0] ?? "e2e"}`, [
      { key: "kai", name: "Kai Context", blsExpiryDays: 400 },
      { key: "una", name: "Una Unassigned", blsExpiryDays: 400 },
    ]);
    base = `/app/organisations/${world.agencyId}/my-shifts`;
    const locations = await world.admin.client
      .from("facility_locations")
      .select("id")
      .eq("agency_facility_id", world.facilityId);
    if (locations.error) throw locations.error;
    locationId = locations.data[0]?.id ?? "";
    const kai = world.extra.kai;
    if (!kai) throw new Error("fixture");
    // Today: in progress now (always the facility's today). Upcoming: in five days.
    const now = await shiftFor(
      kai.workerId,
      local(new Date(Date.now() - 30 * 60_000)),
      local(new Date(Date.now() + 6 * 60 * 60_000)),
    );
    todayShift = now.shiftId;
    await kai.client.rpc("accept_shift_assignment", { p_assignment_id: now.assignmentId });
    await shiftFor(
      kai.workerId,
      { date: isoDay(5), time: "07:00" },
      { date: isoDay(5), time: "15:00" },
    );
    // Past: worked three days ago.
    await arrangePastWork(world, {
      worker: kai,
      facilityId: world.facilityId,
      locationId,
      startAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      endAt: new Date(Date.now() - 3 * 86_400_000 + 8 * 3_600_000).toISOString(),
      events: [],
    });
    // A site address and BUSINESS contacts that are NOT worker-facing.
    const facility = await world.admin.client
      .from("agency_facilities")
      .select("name, facility_type_key, timezone")
      .eq("id", world.facilityId)
      .single();
    if (facility.error) throw facility.error;
    const updated = await world.admin.client.rpc("update_agency_facility", {
      p_facility_id: world.facilityId,
      p_name: facility.data.name,
      p_facility_type: facility.data.facility_type_key,
      p_timezone: facility.data.timezone,
      p_phone: "+1 555 010 9999",
      p_email: "site-office@example.test",
      p_address_line1: "123 Healthway Drive",
      p_locality: "Atlanta",
      p_region: "GA",
      p_postal_code: "30309",
      p_country_code: "US",
    });
    if (updated.error) throw updated.error;
  });

  test("worker: no photo yet → the Chelth facility artwork; no guidance or contact yet", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.extra.kai?.email ?? "");
    await page.goto(base);
    const today = page.getByRole("list", { name: "My assignments" });
    await expect(page.getByRole("heading", { level: 2, name: "Today" })).toBeVisible();
    await expect(today.locator("img")).toHaveCount(0);
    await today
      .getByRole("link", { name: /^Shift details: Mercy Rehab/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Mercy Rehab" })).toBeVisible();
    await expect(page.getByRole("main").locator("img")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Arrival" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Call / })).toHaveCount(0);
    await page.context().close();
  });

  test("agency: an admin sets guidance, the worker contact, a unit and a photo", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.admin.email);
    const facilityPath = `/app/organisations/${world.agencyId}/facilities/${world.facilityId}`;
    await page.goto(facilityPath);
    await page.getByRole("link", { name: "Verify now" }).first().click();
    await page.getByLabel("Authentication code").fill(generateTotp(world.admin.totpSecret ?? ""));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(new RegExp(`${facilityPath}$`), AFTER_ACTION);

    const panel = page.getByRole("region", { name: "For workers" });
    await panel.getByLabel("Parking").fill("On-site parking in the visitor garage.");
    await panel
      .getByLabel("Arrival and check-in")
      .fill("Use the east entrance; report to the ward desk.");
    await panel.getByLabel("Contact for workers").fill("Nursing supervisor desk");
    // Validation: a contact needs a phone.
    await panel.getByRole("button", { name: "Save arrival information" }).click();
    await expect(
      panel.getByText("Add both a contact name or desk and a phone number"),
    ).toBeVisible();
    // The form resets after a refused save (React form actions): fill it again.
    await panel.getByLabel("Parking").fill("On-site parking in the visitor garage.");
    await panel
      .getByLabel("Arrival and check-in")
      .fill("Use the east entrance; report to the ward desk.");
    await panel.getByLabel("Contact for workers").fill("Nursing supervisor desk");
    await panel.getByLabel("Contact phone").fill("+1 404 555 0187");
    await panel.getByRole("button", { name: "Save arrival information" }).click();
    await expect(panel.getByText("Worker arrival information saved.")).toBeVisible(AFTER_ACTION);

    await panel.getByTestId("facility-image-file").setInputFiles({
      name: "mercy.png",
      mimeType: "image/png",
      buffer: PNG,
    });
    await panel.getByRole("button", { name: "Upload photo" }).click();
    await expect(panel.getByText("Facility photo updated.")).toBeVisible(AFTER_ACTION);
    await expect(panel.locator("img")).toHaveCount(1);
    // Content that is not an image is refused by the server.
    await panel.getByTestId("facility-image-file").setInputFiles({
      name: "fake.png",
      mimeType: "image/png",
      buffer: Buffer.from("<svg onload=alert(1)>"),
    });
    await panel.getByRole("button", { name: "Upload photo" }).click();
    await expect(panel.getByRole("alert")).toContainText("not a JPG or PNG", AFTER_ACTION);
    await qaScreenshot(page, "e9-3d-facility-for-workers");
    await expectNoA11yViolations(page);

    // Unit on the shift.
    await page.goto(`/app/organisations/${world.agencyId}/shifts/${todayShift}`);
    await page.getByLabel("Unit / department").fill("ICU");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(
      page.getByRole("region", { name: "Details" }).getByText("ICU", { exact: true }),
    ).toBeVisible(AFTER_ACTION);
    await page.context().close();
  });

  test("worker: Today / Upcoming / Past and the enriched Shift Details", async ({ browser }) => {
    const page = await signedIn(browser, world.extra.kai?.email ?? "");
    await page.goto(base);
    const today = page.getByRole("list", { name: "My assignments" });
    await expect(today).toContainText("ICU");
    await expect(today.locator("img").first()).toHaveAttribute(
      "src",
      /\/storage\/v1\/object\/sign\/facility-images\//,
    );
    await expect(page.getByRole("list", { name: "Upcoming shifts" })).toContainText("Mercy Rehab");
    await qaScreenshot(page, "e9-3d-my-shifts-today");
    await expectNoA11yViolations(page);

    await today
      .getByRole("link", { name: /^Shift details: Mercy Rehab/ })
      .first()
      .click();
    const main = page.getByRole("main");
    await expect(main).toContainText("123 Healthway Drive, Atlanta, GA 30309");
    const facts = page.getByRole("region", { name: "Shift facts" });
    await expect(facts).toContainText("Certified Nursing Assistant");
    await expect(facts).toContainText("ICU");
    await expect(facts).toContainText("Nursing supervisor desk");
    await expect(facts.getByRole("link", { name: "Call Nursing supervisor desk" })).toHaveAttribute(
      "href",
      "tel:+14045550187",
    );
    const directions = page.getByRole("link", { name: /^Get directions/ }).first();
    const href = (await directions.getAttribute("href")) ?? "";
    expect(href).toMatch(
      /^https:\/\/(www\.google\.com\/maps\/dir\/\?api=1&destination=|maps\.apple\.com\/\?daddr=)/,
    );
    expect(decodeURIComponent(href)).toContain("123 Healthway Drive, Atlanta, GA 30309, US");
    // Destination only: nothing about the worker or the shift goes to the map provider.
    expect(decodeURIComponent(href)).not.toMatch(/Kai|kai|ICU|Nursing|[0-9a-f]{8}-[0-9a-f]{4}/);
    const arrival = page.getByRole("region", { name: "Arrival" });
    await expect(arrival).toContainText("On-site parking in the visitor garage.");
    await expect(arrival).toContainText("Use the east entrance; report to the ward desk.");
    await expect(page.getByRole("list", { name: "Shift requirements" })).toContainText(
      "Basic Life Support (BLS)",
    );
    await expect(page.getByRole("list", { name: "Shift requirements" })).toContainText(
      /Valid until/,
    );
    // The site's business phone and e-mail are not worker-facing.
    await expect(main).not.toContainText("555 010 9999");
    await expect(main).not.toContainText("site-office@example.test");
    await expect(page.getByRole("region", { name: "Need help?" })).toBeVisible();
    await qaScreenshot(page, "e9-3d-shift-details");
    await expectNoA11yViolations(page);

    const tabs = page.getByRole("navigation", { name: "Shift period" });
    await page.goto(base);
    await tabs.getByRole("link", { name: "Upcoming" }).click();
    await expect(page.getByRole("list", { name: "My assignments" })).toContainText("Mercy Rehab");
    await expect(
      page.getByRole("list", { name: "My assignments" }).getByRole("listitem"),
    ).toHaveCount(1);
    await tabs.getByRole("link", { name: "Past" }).click();
    const past = page.getByRole("list", { name: "My assignments" });
    await expect(past.getByRole("listitem")).toHaveCount(1);
    await past.getByRole("link", { name: /^Shift details: Mercy Rehab/ }).click();
    // A past (non-open) shift carries no live context: no address, contact or guidance.
    await expect(page.getByRole("main")).not.toContainText("Healthway");
    await expect(page.getByRole("region", { name: "Arrival" })).toHaveCount(0);
    await page.context().close();
  });

  test("another worker without an assignment there gets none of it", async ({ browser }) => {
    const page = await signedIn(browser, world.extra.una?.email ?? "");
    await page.goto(base);
    await expect(page.getByText("You have no assignments yet.")).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText(/Healthway|Nursing supervisor|ICU/);
    await expect(page.getByRole("main").locator("img")).toHaveCount(0);
    await page.context().close();
  });

  test("Shift Details at phone widths stays a centred app column", async ({ browser }) => {
    const page = await signedIn(browser, world.extra.kai?.email ?? "");
    await page.goto(base);
    await page
      .getByRole("list", { name: "My assignments" })
      .getByRole("link", { name: /^Shift details: Mercy Rehab/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/my-shifts\/[0-9a-f-]{36}$/);
    const detail = page.url();
    for (const width of [360, 375, 390, 412, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(detail);
      await expect(page.getByRole("heading", { level: 1, name: "Mercy Rehab" })).toBeVisible();
      await expectNoPageOverflow(page);
      const column = await page.getByRole("main").locator(":scope > div").first().boundingBox();
      expect(column?.width ?? 0).toBeLessThanOrEqual(576);
    }
    await page.context().close();
  });
});
