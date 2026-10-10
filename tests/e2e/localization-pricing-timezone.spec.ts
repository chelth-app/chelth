import AxeBuilder from "@axe-core/playwright";
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";

import {
  type Browser,
  type BrowserContextOptions,
  expect,
  type Page,
  test,
} from "@playwright/test";

import { generateTotp } from "../support/totp";
import { createStaffingWorld, type StaffingWorld } from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn, SIGNED_IN_LANDING } from "./support";

/*
 * P0-E9-3F: facility photo (the real file-chooser path), personal display
 * timezone (automatic / manual), workspace spelling (License / Licence), the
 * time calculation method and the Day Shift label.
 */

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const AFTER_ACTION = { timeout: 20_000 };

/** A real, decodable PNG; `noise` makes it incompressible (a large "camera" image). */
function png(width: number, height: number, noise = false): Buffer {
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
  header[8] = 8;
  header[9] = 2;
  const rows = Array.from({ length: height }, () =>
    Buffer.concat([
      Buffer.from([0]),
      noise ? randomBytes(width * 3) : Buffer.alloc(width * 3, 0x9f),
    ]),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 0 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
  expect(results.violations).toEqual([]);
  await expectNoPageOverflow(page);
}

async function signedIn(browser: Browser, email: string, options: BrowserContextOptions = {}) {
  const page = await (await browser.newContext(options)).newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(SIGNED_IN_LANDING, AFTER_ACTION);
  return page;
}

async function stepUp(page: Page, world: StaffingWorld, path: string) {
  await page.goto(path);
  await page.getByRole("link", { name: "Verify now" }).first().click();
  await page.getByLabel("Authentication code").fill(generateTotp(world.admin.totpSecret ?? ""));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`), AFTER_ACTION);
}

async function choosePhoto(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("group", { name: "Facility photo" }).locator("label").last().click();
  await (await chooser).setFiles(file);
}

test.describe.serial("P0-E9-3F localization, pricing, timezone and facility photo", () => {
  test.setTimeout(240_000);
  let world: StaffingWorld;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`e93f-${testInfo.project.name.split("-")[0] ?? "e2e"}`);
  });

  test("facility photo: choose → selected → upload → preview → replace; failures are explained", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.admin.email);
    const facilityPath = `/app/organisations/${world.agencyId}/facilities/${world.facilityId}`;
    await stepUp(page, world, facilityPath);
    const group = page.getByRole("group", { name: "Facility photo" });
    const panel = page.getByRole("region", { name: "For workers" });

    // Empty state: no upload button until a photo is chosen (nothing that looks dead).
    await expect(group).toContainText("Add a photo workers can use to recognise the facility.");
    await expect(group).toContainText("JPG or PNG · up to 2 MB");
    await expect(group.getByRole("button", { name: /Upload photo/ })).toHaveCount(0);
    await expect(panel.locator("img")).toHaveCount(0);

    // Invalid type: refused at selection, with a reason.
    await choosePhoto(page, {
      name: "plan.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4"),
    });
    await expect(group.getByRole("alert")).toHaveText("Choose a JPG or PNG photo.");

    // Selected: name and size, then one explicit upload.
    await choosePhoto(page, {
      name: "facility-front.png",
      mimeType: "image/png",
      buffer: png(64, 40),
    });
    await expect(group).toContainText("facility-front.png");
    await expect(group).toContainText("Ready to upload");
    await qaScreenshot(page, "e9-3f-facility-photo-selected");

    // Network failure: nothing claimed, the reason is shown, the selection is kept.
    await page.route("**/storage/v1/object/upload/sign/**", (route) => route.abort());
    await group.getByRole("button", { name: /Upload photo/ }).click();
    await expect(group.getByRole("alert")).toHaveText(
      "The photo was not uploaded. Check your connection and try again.",
      AFTER_ACTION,
    );
    await page.unroute("**/storage/v1/object/upload/sign/**");

    // Success (a double tap uploads once).
    const upload = group.getByRole("button", { name: /Upload photo/ });
    await upload.dblclick();
    await expect(group.getByRole("status")).toHaveText("Facility photo updated.", AFTER_ACTION);
    await expect(panel.locator("img")).toHaveCount(1);
    await expect(group.locator("label").last()).toHaveText("Replace photo");
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "e9-3f-facility-photo-uploaded");

    // A camera-sized photo (> 2 MB) is resized in the browser and uploaded.
    const big = png(1100, 700, true);
    expect(big.length).toBeGreaterThan(2 * 1024 * 1024);
    await choosePhoto(page, { name: "IMG_0412.png", mimeType: "image/png", buffer: big });
    await expect(group).toContainText("resized for upload", AFTER_ACTION);
    await group.getByRole("button", { name: /Upload photo/ }).click();
    await expect(group.getByRole("status")).toHaveText("Facility photo updated.", AFTER_ACTION);
    await page.context().close();

    // A role without facility.manage never sees the control.
    const scheduler = await signedIn(browser, world.scheduler.email);
    await scheduler.goto(facilityPath);
    await expect(scheduler.getByRole("group", { name: "Facility photo" })).toHaveCount(0);
    await scheduler.context().close();
  });

  test("timezone: automatic follows the device; manual is kept; back to the device", async ({
    browser,
  }) => {
    const lagos = await signedIn(browser, world.wendy.email, { timezoneId: "Africa/Lagos" });
    await lagos.goto("/app/account");
    const timezone = lagos.getByRole("region", { name: "Timezone" });
    await expect(timezone).toContainText("Automatically detected");
    await expect(lagos.getByTestId("display-timezone")).toHaveText("Africa/Lagos");
    await expect
      .poll(async () => {
        const { data } = await world.wendy.client.from("profiles").select("timezone").single();
        return data?.timezone;
      }, AFTER_ACTION)
      .toBe("Africa/Lagos");
    await expectNoA11yViolations(lagos);

    await timezone.getByRole("button", { name: "Change timezone" }).click();
    await timezone.getByLabel("Choose a timezone").fill("Mars/Olympus");
    await timezone.getByRole("button", { name: "Save timezone" }).click();
    await expect(timezone).toContainText("Choose a timezone from the list", AFTER_ACTION);
    // The picker stays open after a refused value.
    await timezone.getByLabel("Choose a timezone").fill("Europe/London");
    await timezone.getByRole("button", { name: "Save timezone" }).click();
    await expect(lagos.getByTestId("display-timezone")).toHaveText("Europe/London", AFTER_ACTION);
    await qaScreenshot(lagos, "e9-3f-timezone-manual");
    await lagos.context().close();

    // The phone moves to Tokyo: a manual choice is not overwritten.
    const tokyo = await signedIn(browser, world.wendy.email, { timezoneId: "Asia/Tokyo" });
    await tokyo.goto("/app/account");
    await expect(tokyo.getByTestId("display-timezone")).toHaveText("Europe/London");
    await tokyo.getByRole("button", { name: "Use device timezone" }).click();
    await expect(tokyo.getByRole("region", { name: "Timezone" })).toContainText(
      "Automatically detected",
      AFTER_ACTION,
    );
    await expect(tokyo.getByTestId("display-timezone")).toHaveText("Asia/Tokyo");
    await tokyo.context().close();
  });

  test("workspace spelling, time calculation method and Day Shift", async ({ browser }) => {
    const page = await signedIn(browser, world.admin.email);
    const settings = `/app/organisations/${world.agencyId}/settings`;
    await stepUp(
      page,
      world,
      `/app/organisations/${world.agencyId}/facilities/${world.facilityId}`,
    );

    // Fallback (en-US): License.
    await page.goto(`/app/organisations/${world.agencyId}/compliance`);
    await expect(page.getByLabel("Jurisdiction (licenses)").first()).toBeVisible();

    // Workspace set to en-GB: Licence; identifiers are untouched.
    await page.goto(settings);
    await page.getByLabel("Language and spelling").selectOption("en-GB");
    await page.getByRole("button", { name: "Save workspace language" }).click();
    await expect(page.getByText("Workspace language saved.")).toBeVisible(AFTER_ACTION);
    await page.goto(`/app/organisations/${world.agencyId}/compliance`);
    await expect(page.getByLabel("Jurisdiction (licences)").first()).toBeVisible();
    const rn = page.getByRole("option", { name: /Registered Nurse \(RN\) licence/ });
    if ((await rn.count()) > 0) await expect(rn.first()).toHaveAttribute("value", "rn_license");

    // Time calculation: exact minutes by default; nearest 15 from today.
    await page.goto(`${settings}/rates`);
    const card = page.getByRole("region", { name: "Time Calculation Method" });
    await expect(card).toContainText("Exact minutes");
    await expect(card).toContainText("Worked 7h 37m · calculation basis 457 minutes");
    await expect(card).toContainText("$228.50");
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "e9-3f-time-calculation");
    await card.getByLabel("Round to the nearest 15 minutes").check();
    await card.getByRole("button", { name: "Save time calculation method" }).click();
    await expect(card).toContainText("Nearest 15 minutes", AFTER_ACTION);
    await expect(card).toContainText("$225.00");

    // Day Shift: the default classification, shown on the shift record.
    const start = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const shift = await world.scheduler.client.rpc("create_shift", {
      p_agency_facility_id: world.facilityId,
      p_facility_location_id:
        (
          await world.admin.client
            .from("facility_locations")
            .select("id")
            .eq("agency_facility_id", world.facilityId)
            .limit(1)
            .single()
        ).data?.id ?? "",
      p_discipline_key: "cna",
      p_shift_date: start,
      p_start_time: "07:00",
      p_end_time: "15:00",
      p_requested_headcount: 1,
    });
    if (shift.error) throw shift.error;
    await page.goto(`/app/organisations/${world.agencyId}/shifts/${shift.data}`);
    await expect(page.getByRole("main")).toContainText("Day Shift");
    await expect(page.getByRole("main")).not.toContainText(/\bRegular shift\b/);
    await page.context().close();
  });
});
