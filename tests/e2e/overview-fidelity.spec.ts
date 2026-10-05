import { type Browser, expect, type Page, test } from "@playwright/test";

import { generateTotp } from "../support/totp";
import { createStaffingWorld, isoDay, type StaffingWorld } from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn } from "./support";

/*
 * Operations Overview visual QA (P0-E8-S9A4 follow-up). Builds a world with
 * reference-like density through the public API only — real shifts,
 * assignments, clock-ins and facility requests — so the 1536 x 1024 overlay
 * compares populated panels. QA fixture only: no seed or product change.
 */

/**
 * A real timezone where it is currently daytime, so today's schedule shows
 * ordinary day shifts whenever the suite runs (the reference shows day shifts).
 */
const DAYTIME_ZONES = [
  "Pacific/Auckland",
  "Australia/Sydney",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/Athens",
  "Europe/London",
  "America/Sao_Paulo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Pacific/Honolulu",
];

function localHour(timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(
      new Date(),
    ),
  );
}

function daytimeZone(): string {
  return [...DAYTIME_ZONES].sort(
    (a, b) => Math.abs(localHour(a) - 12.5) - Math.abs(localHour(b) - 12.5),
  )[0] as string;
}

function local(instant: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
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

async function must<T>(promise: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await promise;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("no data");
  return data;
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  return page;
}

const WORKERS = [
  { key: "ana", name: "Ana Ortiz" },
  { key: "ben", name: "Ben Clarke" },
  { key: "cara", name: "Cara Diaz" },
  { key: "dev", name: "Dev Patel" },
  { key: "eli", name: "Eli Moore" },
];

test.describe.serial("Operations Overview visual QA density", () => {
  test.setTimeout(300_000);
  let world: StaffingWorld;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(300_000);
    world = await createStaffingWorld(`ovqa-${testInfo.project.name.split("-")[0] ?? "e2e"}`, [
      ...WORKERS.map((worker) => ({ ...worker, blsExpiryDays: 400 })),
      // Not scheduled; a BLS expiring soon, so Workforce shows a real expiry.
      { key: "fay", name: "Fay Hughes", blsExpiryDays: 20 },
    ]);
    const locations = await must(
      world.admin.client
        .from("facility_locations")
        .select("id")
        .eq("agency_facility_id", world.facilityId),
    );
    const locationId = locations[0]?.id ?? "";

    // Three client facilities in a timezone where it is daytime now, set up
    // through the same agency RPCs the fixture uses.
    const zone = daytimeZone();
    const facilities: { facilityId: string; locationId: string }[] = [];
    for (const [name, unit] of [
      ["Riverside Care Center", "Med Surg"],
      ["Maple Grove Hospital", "ICU"],
      ["Sunridge Care Center", "Long Term Care"],
    ] as const) {
      const facilityId = await must(
        world.admin.client.rpc("create_agency_facility", {
          p_agency_organisation_id: world.agencyId,
          p_name: name,
          p_facility_type: "hospital",
          p_timezone: zone,
        }),
      );
      const facilityLocation = await must(
        world.admin.client.rpc("create_facility_location", {
          p_facility_id: facilityId,
          p_name: unit,
        }),
      );
      const relationshipId = await must(
        world.admin.client.rpc("create_facility_relationship", { p_facility_id: facilityId }),
      );
      const active = await world.admin.client.rpc("set_facility_relationship_status", {
        p_relationship_id: relationshipId,
        p_status: "active",
      });
      if (active.error) throw active.error;
      facilities.push({ facilityId, locationId: facilityLocation });
    }

    // Today's schedule: five accepted day-shift assignments, two clocked in.
    const today = local(new Date(), zone).date;
    const dayShifts = [
      ["07:00", "15:00"],
      ["07:00", "19:00"],
      ["08:00", "16:00"],
      ["09:00", "17:00"],
      ["11:00", "19:00"],
    ] as const;
    for (const [index, worker] of WORKERS.entries()) {
      const [startTime, endTime] = dayShifts[index] ?? ["07:00", "15:00"];
      const site = facilities[index % facilities.length];
      if (!site) throw new Error("no facility");
      const shiftId = await must(
        world.scheduler.client.rpc("create_shift", {
          p_agency_facility_id: site.facilityId,
          p_facility_location_id: site.locationId,
          p_discipline_key: "cna",
          p_shift_date: today,
          p_start_time: startTime,
          p_end_time: endTime,
          p_requested_headcount: 1,
          p_open: true,
        }),
      );
      const who = world.extra[worker.key];
      if (!who) throw new Error(`unknown worker ${worker.key}`);
      const decision = await must(
        world.scheduler.client.rpc("assign_worker_to_shift", {
          p_shift_id: shiftId,
          p_agency_worker_id: who.workerId,
        }),
      );
      const assignmentId = decision[0]?.assignment_id ?? "";
      const accepted = await who.client.rpc("accept_shift_assignment", {
        p_assignment_id: assignmentId,
      });
      if (accepted.error) throw accepted.error;
      if (index < 2) {
        await who.client.rpc("clock_in_assignment", { p_assignment_id: assignmentId });
      }
    }

    // Staffing requests: five facility requests over the coming days; two are
    // opened by the agency, so the panel shows both statuses.
    const requestTimes = [
      ["07:00", "15:00"],
      ["15:00", "23:00"],
      ["07:00", "19:00"],
      ["19:00", "07:00"],
      ["11:00", "19:00"],
    ] as const;
    for (const [index, [startTime, endTime]] of requestTimes.entries()) {
      const requestId = await must(
        world.facilityAdmin.client.rpc("submit_facility_shift_request", {
          p_relationship_id: world.relationshipId,
          p_facility_location_id: locationId,
          p_discipline_key: "cna",
          p_shift_date: isoDay(index + 1),
          p_start_time: startTime,
          p_end_time: endTime,
          p_requested_headcount: index % 2 === 0 ? 2 : 1,
        }),
      );
      if (index >= 3) {
        const opened = await world.scheduler.client.rpc("open_shift", { p_shift_id: requestId });
        if (opened.error) throw opened.error;
      }
    }
  });

  test("populated panels at the reference canvas", async ({ browser }) => {
    const page = await signedIn(browser, world.scheduler.email);
    await page.setViewportSize({ width: 1512, height: 996 });
    await page.goto(`/app/organisations/${world.agencyId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Operations Overview" }),
    ).toBeVisible();

    const schedule = page.getByRole("region", { name: "Today's schedule table" });
    await expect(schedule.locator("tbody tr")).toHaveCount(WORKERS.length);
    const requests = page.getByRole("region", { name: "Staffing requests table" });
    await expect(requests.locator("tbody tr")).toHaveCount(5);
    await expect(page.getByRole("list", { name: "Workers by status" })).toContainText("Active");

    await qaScreenshot(page, "ovqa-overview");
    for (const [width, height] of [
      [1536, 1024],
      [1280, 900],
      [412, 915],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expectNoPageOverflow(page);
      await qaScreenshot(page, "ovqa-overview");
    }
    await page.context().close();
  });

  test("Workforce at the reference canvas, with Professional Details open", async ({ browser }) => {
    // The locked Workforce PNG draws the app at 0.888 scale in a 1515 x 1001 frame.
    const context = await browser.newContext({
      viewport: { width: 1706, height: 1127 },
      deviceScaleFactor: 0.888,
    });
    const page = await context.newPage();
    await signIn(page, world.admin.email);
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
    const path = `/app/organisations/${world.agencyId}/workforce`;
    await page.goto(path);
    // Step up through the real verify page, so Add Professional is available.
    await page.getByRole("link", { name: "Verify now" }).click();
    await page.getByLabel("Authentication code").fill(generateTotp(world.admin.totpSecret ?? ""));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`), { timeout: 20_000 });

    await expect(page.getByRole("link", { name: "Add Professional" })).toBeVisible();
    const table = page.getByRole("region", { name: "Workers table" });
    await expect(table.locator("tbody tr")).toHaveCount(8);
    await expect(table).toContainText("On shift");
    await qaScreenshot(page, "wfqa-workforce");

    await table.getByRole("button", { name: "Details for Ana Ortiz" }).click();
    const drawer = page.getByRole("dialog", { name: "Professional Details" });
    await expect(drawer).toContainText("Ana Ortiz");
    await expect(drawer.getByRole("link", { name: "Open worker record" })).toBeVisible();
    await qaScreenshot(page, "wfqa-workforce-drawer");
    // Credentials tab (real readiness requirements): current, then expiring.
    await drawer.getByRole("tab", { name: "Credentials" }).click();
    await expect(drawer.getByRole("tab", { name: "Credentials" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(drawer.getByRole("tabpanel")).toContainText("Requirement met");
    await qaScreenshot(page, "wfqa-drawer-credentials-current");
    await page.keyboard.press("Escape");
    await table.getByRole("button", { name: "Details for Fay Hughes" }).click();
    await drawer.getByRole("tab", { name: "Credentials" }).click();
    await expect(drawer.getByRole("tabpanel")).toContainText("Expires soon");
    await qaScreenshot(page, "wfqa-drawer-credentials-expiring");
    await page.keyboard.press("Escape");

    // Worker Record inherits the locked depth (reached from the drawer's primary action).
    await table.getByRole("button", { name: "Details for Ana Ortiz" }).click();
    await drawer.getByRole("link", { name: "Open Worker Record" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Ana Ortiz" })).toBeVisible();
    await qaScreenshot(page, "wfqa-worker-record");
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectNoPageOverflow(page);
    await qaScreenshot(page, "wfqa-worker-record");
    await page.setViewportSize({ width: 1706, height: 1127 });
    await page.goto(path);

    // The locked filter row filters the real workforce (GET, display filters).
    const filters = page.getByRole("form", { name: "Filter workers" });
    await filters.getByRole("searchbox", { name: "Search workers" }).fill("ana");
    await filters.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/q=ana/);
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await page.goto(`${path}?credentials=attention`);
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(table).toContainText("Fay Hughes");
    await page.goto(`${path}?role=cna`);
    await expect(table.locator("tbody tr")).toHaveCount(8);
    await page.goto(path);

    for (const [width, height] of [
      [1280, 900],
      [768, 1024],
      [412, 915],
      [375, 812],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expectNoPageOverflow(page);
      await qaScreenshot(page, "wfqa-workforce");
    }
    await context.close();
  });
});
