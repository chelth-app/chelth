import AxeBuilder from "@axe-core/playwright";
import {
  type Browser,
  type BrowserContextOptions,
  expect,
  type Page,
  test,
} from "@playwright/test";

import { createStaffingWorld, type StaffingWorld } from "./staffing-fixture";
import { signIn } from "./support";

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const AFTER_ACTION = { timeout: 20_000 };
const TZ = "America/New_York";
const SITE = { latitude: 40.7128, longitude: -74.006 };
const FAR_AWAY = { latitude: 40.7128 + 0.009, longitude: -74.006 }; // ≈ 1 km north

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
  expect(results.violations).toEqual([]);
}

async function must<T>(promise: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await promise;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("no data");
  return data;
}

function local(instant: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
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

async function signedIn(
  browser: Browser,
  email: string,
  options: BrowserContextOptions = {},
): Promise<Page> {
  const page = await (await browser.newContext(options)).newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app$/, AFTER_ACTION);
  return page;
}

test.describe.serial("time & attendance", () => {
  test.setTimeout(240_000);

  let world: StaffingWorld;
  let mainLocation: string;
  let eastLocation: string;
  let geoShift: string;

  /** Accepted assignment for an extra worker on a new shift starting/ending relative to now. */
  async function acceptedShift(
    worker: string,
    locationId: string,
    startMinutes: number,
    endMinutes: number,
  ) {
    const start = local(new Date(Date.now() + startMinutes * 60_000));
    const end = local(new Date(Date.now() + endMinutes * 60_000));
    const shiftId = await must(
      world.scheduler.client.rpc("create_shift", {
        p_agency_facility_id: world.facilityId,
        p_facility_location_id: locationId,
        p_discipline_key: "cna",
        p_shift_date: start.date,
        p_start_time: start.time,
        p_end_time: end.time,
        p_requested_headcount: 3,
        p_open: true,
      }),
    );
    const who = world.extra[worker];
    if (!who) throw new Error(`unknown worker ${worker}`);
    const decision = await must(
      world.scheduler.client.rpc("assign_worker_to_shift", {
        p_shift_id: shiftId,
        p_agency_worker_id: who.workerId,
      }),
    );
    const accepted = await who.client.rpc("accept_shift_assignment", {
      p_assignment_id: decision[0]?.assignment_id ?? "",
    });
    if (accepted.error) throw accepted.error;
    return shiftId;
  }

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`att-${testInfo.project.name.split("-")[0] ?? "e2e"}`, [
      { key: "ana", name: "Ana Ontime", blsExpiryDays: 400 },
      { key: "leo", name: "Leo Late", blsExpiryDays: 400 },
      { key: "gia", name: "Gia Geofence", blsExpiryDays: 400 },
      { key: "max", name: "Max Missed", blsExpiryDays: 400 },
    ]);
    const locations = await must(
      world.admin.client
        .from("facility_locations")
        .select("id")
        .eq("agency_facility_id", world.facilityId),
    );
    mainLocation = locations[0]?.id ?? "";
    eastLocation = await must(
      world.admin.client.rpc("create_facility_location", {
        p_facility_id: world.facilityId,
        p_name: "Mercy East",
      }),
    );
    const geofence = await world.admin.client.rpc("set_location_geofence", {
      p_facility_location_id: eastLocation,
      p_enabled: true,
      p_latitude: SITE.latitude,
      p_longitude: SITE.longitude,
      p_radius_meters: 200,
      p_max_accuracy_meters: 500,
      p_outside_policy: "block",
    });
    if (geofence.error) throw geofence.error;
  });

  test("Flow 1: a worker clocks in and out from My Shifts", async ({ browser }) => {
    await acceptedShift("ana", mainLocation, 2, 14);
    const ana = await signedIn(browser, world.extra.ana?.email ?? "");
    await ana.goto(`/app/organisations/${world.agencyId}/my-shifts`);
    const card = ana.getByRole("list", { name: "My attendance" }).getByRole("listitem").first();
    await expect(card).toContainText("Not started");
    await expectNoA11yViolations(ana);
    await ana.getByRole("button", { name: "Clock in at Mercy Rehab" }).click();
    await expect(card).toContainText("Clocked in", AFTER_ACTION);
    await ana.getByRole("button", { name: "Clock out at Mercy Rehab" }).click();
    await expect(card).toContainText("Completed", AFTER_ACTION);
    await ana.context().close();
  });

  test("Flow 2: a late clock-in is visible to the agency", async ({ browser }) => {
    await acceptedShift("leo", mainLocation, -20, 180);
    const leo = await signedIn(browser, world.extra.leo?.email ?? "");
    await leo.goto(`/app/organisations/${world.agencyId}/my-shifts`);
    await leo.getByRole("button", { name: "Clock in at Mercy Rehab" }).click();
    await expect(leo.getByRole("list", { name: "Attendance notes" })).toContainText(
      "Late clock-in",
      AFTER_ACTION,
    );
    await leo.context().close();

    const admin = await signedIn(browser, world.admin.email);
    await admin.goto(`/app/organisations/${world.agencyId}/attendance`);
    const row = admin
      .getByRole("region", { name: "Scheduled workers table" })
      .getByRole("row", { name: /Leo Late/ });
    await expect(row).toContainText("Needs review");
    await expect(row).toContainText("Late clock-in");
    await expectNoA11yViolations(admin);
    await admin.context().close();
  });

  test("Flow 3: outside a blocking geofence the clock-in is refused, inside it works", async ({
    browser,
  }) => {
    geoShift = await acceptedShift("gia", eastLocation, -2, 180);
    const gia = await signedIn(browser, world.extra.gia?.email ?? "", {
      permissions: ["geolocation"],
      geolocation: { ...FAR_AWAY, accuracy: 20 },
    });
    await gia.goto(`/app/organisations/${world.agencyId}/my-shifts`);
    await gia.getByRole("button", { name: "Clock in at Mercy Rehab" }).click();
    // The reason is explained BEFORE the browser location is read.
    await expect(gia.getByRole("region", { name: "Location check" })).toContainText(
      "uses your location only for this attendance action",
    );
    await gia.getByRole("button", { name: "Share location and clock in" }).click();
    await expect(gia.getByRole("alert").filter({ hasText: "outside the site area" })).toBeVisible(
      AFTER_ACTION,
    );

    await gia.context().setGeolocation({ ...SITE, accuracy: 20 });
    await gia.getByRole("button", { name: "Clock in at Mercy Rehab" }).click();
    await gia.getByRole("button", { name: "Share location and clock in" }).click();
    await expect(
      gia.getByRole("list", { name: "My attendance" }).getByRole("listitem").first(),
    ).toContainText(/Clocked in|Needs review/, AFTER_ACTION);
    await gia.context().close();
  });

  test("Flow 4: a worker requests a correction; a reviewer approves; the worker sees the outcome", async ({
    browser,
  }) => {
    await acceptedShift("max", mainLocation, -40, 180);
    const max = await signedIn(browser, world.extra.max?.email ?? "");
    await max.goto(`/app/organisations/${world.agencyId}/my-shifts`);
    const card = max.getByRole("list", { name: "My attendance" }).getByRole("listitem").first();
    await card.getByText("Request a time correction").click();
    await card
      .getByRole("combobox", { name: "Reason" })
      .selectOption({ label: "I forgot to clock" });
    const actual = local(new Date(Date.now() - 35 * 60_000));
    await card.getByLabel("Date").fill(actual.date);
    await card.getByLabel("Actual time").fill(actual.time);
    await card.getByRole("button", { name: "Send correction request" }).click();
    await expect(card.getByText("Correction requested. Your agency will review it.")).toBeVisible(
      AFTER_ACTION,
    );

    const admin = await signedIn(browser, world.admin.email);
    await admin.goto(`/app/organisations/${world.agencyId}/attendance`);
    await admin.getByRole("button", { name: "Approve correction for Max Missed" }).click();
    await expect(admin.getByText("No correction requests waiting.")).toBeVisible(AFTER_ACTION);
    await admin.context().close();

    await max.reload();
    await expect(max.getByRole("list", { name: "My correction requests" })).toContainText(
      "Approved",
    );
    await expect(card).toContainText("Clocked in");
    await max.context().close();
  });

  test("Flow 5: the facility sees safe attendance status and never coordinates", async ({
    browser,
  }) => {
    const facility = await signedIn(browser, world.facilityAdmin.email);
    await facility.goto(`/app/organisations/${world.facilityOrgId}/staffing-requests/${geoShift}`);
    const table = facility.getByRole("region", { name: "Attendance for this request" });
    await expect(table).toContainText("Gia Geofence");
    await expect(table).toContainText("Inside site area");
    await expect(facility.locator("main")).not.toContainText(/40\.71|74\.00|latitude|longitude/i);
    await facility.context().close();
  });

  test("Flow 6: other tenants cannot reach attendance routes", async ({ browser }) => {
    const beta = await signedIn(browser, world.betaAdmin.email);
    expect((await beta.goto(`/app/organisations/${world.agencyId}/attendance`))?.status()).toBe(
      404,
    );
    await beta.context().close();
    const facility = await signedIn(browser, world.facilityAdmin.email);
    expect((await facility.goto(`/app/organisations/${world.agencyId}/attendance`))?.status()).toBe(
      404,
    );
    await facility.context().close();
    const worker = await signedIn(browser, world.wendy.email);
    expect((await worker.goto(`/app/organisations/${world.agencyId}/attendance`))?.status()).toBe(
      404,
    );
    await worker.context().close();
  });
});
