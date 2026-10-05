import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import { createStaffingWorld, isoDay, type StaffingWorld } from "./staffing-fixture";
import { expectNoPageOverflow, signIn } from "./support";

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const AFTER_ACTION = { timeout: 20_000 };

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
  expect(results.violations).toEqual([]);
  // P0-E8-S2: wide tables scroll inside their region, never the page (412 px on mobile).
  await expectNoPageOverflow(page);
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app$/, AFTER_ACTION);
  return page;
}

async function must<T>(promise: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await promise;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("no data");
  return data;
}

test.describe.serial("assignment operations: offers, readiness, suspension", () => {
  test.setTimeout(240_000);

  let world: StaffingWorld;
  let scheduler: Page;
  let offerShiftPath: string;

  async function mercyLocation(): Promise<string> {
    const rows = await must(
      world.admin.client
        .from("facility_locations")
        .select("id")
        .eq("agency_facility_id", world.facilityId),
    );
    return rows[0]?.id ?? "";
  }

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`ops-${testInfo.project.name.split("-")[0] ?? "e2e"}`, [
      { key: "olga", name: "Olga Offer", blsExpiryDays: 400 },
      { key: "omar", name: "Omar Offer", blsExpiryDays: 400 },
      { key: "eve", name: "Eve Expiring", blsExpiryDays: 60 },
    ]);
    scheduler = await signedIn(browser, world.scheduler.email);
  });

  test("Flow 1: a scheduler offers a shift to eligible workers; a worker accepts and is assigned", async ({
    browser,
  }) => {
    await scheduler.goto(`/app/organisations/${world.agencyId}/shifts`);
    // Locked P3: the existing form is revealed by "+ Create shift" (same route, same action).
    await expect(scheduler.getByRole("heading", { name: "Create a shift" })).toBeHidden();
    await scheduler.getByRole("link", { name: "Create shift" }).click();
    await expect(scheduler.getByRole("heading", { name: "Create a shift" })).toBeVisible();
    await scheduler
      .getByRole("combobox", { name: "Facility and location" })
      .selectOption({ label: "Mercy Rehab — Mercy Main (America/New_York)" });
    await scheduler
      .getByRole("combobox", { name: "Discipline" })
      .selectOption({ label: "Certified Nursing Assistant (CNA)" });
    await scheduler.getByLabel("Shift date").fill(isoDay(4));
    await scheduler.getByLabel("Start time").fill("07:00");
    await scheduler.getByLabel("End time").fill("15:00");
    await scheduler.getByRole("spinbutton", { name: "Workers needed" }).fill("1");
    await scheduler.getByRole("button", { name: "Create shift" }).click();
    await expect(scheduler.getByRole("heading", { name: "Offer shift" })).toBeVisible(AFTER_ACTION);
    offerShiftPath = new URL(scheduler.url()).pathname;

    await scheduler.getByRole("checkbox", { name: "Olga Offer" }).check();
    await scheduler.getByRole("checkbox", { name: "Omar Offer" }).check();
    await scheduler.getByRole("button", { name: "Send offers" }).click();
    await expect(scheduler.getByText("2 offer(s) sent.")).toBeVisible(AFTER_ACTION);
    const offers = scheduler.getByRole("list", { name: "Offers" });
    await expect(offers.getByRole("listitem").filter({ hasText: "Olga Offer" })).toContainText(
      "Offered",
    );
    await expectNoA11yViolations(scheduler);

    const olga = await signedIn(browser, world.extra.olga?.email ?? "");
    await olga.goto(`/app/organisations/${world.agencyId}/my-shifts`);
    const offerList = olga.getByRole("list", { name: "Shift offers" });
    await expect(offerList).toContainText("Mercy Rehab");
    await expectNoA11yViolations(olga);
    await olga.getByRole("button", { name: "Accept offer at Mercy Rehab" }).click();
    await expect(offerList).toContainText("Accepted", AFTER_ACTION);
    await expect(olga.getByRole("list", { name: "My assignments" })).toContainText("Accepted");

    await scheduler.reload();
    await expect(offers.getByRole("listitem").filter({ hasText: "Olga Offer" })).toContainText(
      "Accepted",
    );
    await expect(offers.getByRole("listitem").filter({ hasText: "Omar Offer" })).toContainText(
      "Shift filled",
    );
    await expect(scheduler.getByText("Filled · 1 of 1")).toBeVisible();
    await olga.context().close();
  });

  test("Flow 2: a worker declines an offer and the agency sees it", async ({ browser }) => {
    const locationId = await mercyLocation();
    const shiftId = await must(
      world.scheduler.client.rpc("create_shift", {
        p_agency_facility_id: world.facilityId,
        p_facility_location_id: locationId,
        p_discipline_key: "cna",
        p_shift_date: isoDay(6),
        p_start_time: "07:00",
        p_end_time: "15:00",
        p_requested_headcount: 2,
        p_open: true,
      }),
    );
    await must(
      world.scheduler.client.rpc("offer_shift_to_workers", {
        p_shift_id: shiftId,
        p_agency_worker_ids: [world.extra.omar?.workerId ?? ""],
      }),
    );
    const omar = await signedIn(browser, world.extra.omar?.email ?? "");
    await omar.goto(`/app/organisations/${world.agencyId}/my-shifts`);
    await omar.getByRole("button", { name: "Decline offer at Mercy Rehab" }).click();
    await expect(
      omar
        .getByRole("list", { name: "Shift offers" })
        .getByRole("listitem")
        .filter({ hasText: "Declined" }),
    ).toHaveCount(1, AFTER_ACTION);
    await omar.context().close();

    await scheduler.goto(`/app/organisations/${world.agencyId}/shifts/${shiftId}`);
    await expect(
      scheduler
        .getByRole("list", { name: "Offers" })
        .getByRole("listitem")
        .filter({ hasText: "Omar Offer" }),
    ).toContainText("Declined");
  });

  test("Flow 3: an assignment that stops being eligible needs attention; the worker cannot accept it", async ({
    browser,
  }) => {
    const locationId = await mercyLocation();
    const shiftId = await must(
      world.scheduler.client.rpc("create_shift", {
        p_agency_facility_id: world.facilityId,
        p_facility_location_id: locationId,
        p_discipline_key: "cna",
        p_shift_date: isoDay(5),
        p_start_time: "07:00",
        p_end_time: "15:00",
        p_requested_headcount: 1,
        p_open: true,
      }),
    );
    const assigned = await must(
      world.scheduler.client.rpc("assign_worker_to_shift", {
        p_shift_id: shiftId,
        p_agency_worker_id: world.extra.eve?.workerId ?? "",
      }),
    );
    expect(assigned[0]?.outcome).toBe("allowed");

    // The agency now requires BLS to stay valid for 90 days: Eve's (60 days) no longer does.
    const requirements = await must(
      world.admin.client
        .from("credential_requirements")
        .select("id")
        .eq("agency_organisation_id", world.agencyId)
        .eq("credential_type_key", "bls_certification"),
    );
    const updated = await world.admin.client.rpc("update_credential_requirement", {
      p_requirement_id: requirements[0]?.id ?? "",
      p_must_be_verified: true,
      p_minimum_validity_days: 90,
      p_expiry_warning_days: 30,
      p_status: "active",
    });
    expect(updated.error).toBeNull();

    await scheduler.goto(`/app/organisations/${world.agencyId}/shifts/${shiftId}`);
    await scheduler.getByRole("button", { name: "Re-check readiness" }).click();
    const assignedList = scheduler.getByRole("region", { name: "Assigned workers" });
    await expect(assignedList).toContainText("Needs attention: No longer eligible", AFTER_ACTION);
    await expect(assignedList).toContainText(
      "Basic Life Support (BLS): Does not remain valid long enough",
    );

    await scheduler.goto(`/app/organisations/${world.agencyId}/operations`);
    const attention = scheduler.getByRole("list", { name: "Assignments needing attention" });
    await expect(attention).toContainText("Eve Expiring");
    await expectNoA11yViolations(scheduler);

    const eve = await signedIn(browser, world.extra.eve?.email ?? "");
    await eve.goto(`/app/organisations/${world.agencyId}/my-shifts`);
    await eve.getByRole("button", { name: "Accept shift at Mercy Rehab" }).click();
    await expect(
      eve
        .getByRole("alert")
        .filter({ hasText: "not compliant for this facility on the shift date" }),
    ).toBeVisible(AFTER_ACTION);
    await eve.context().close();
  });

  test("Flow 5: other tenants and roles cannot reach offers, issues or operations", async ({
    browser,
  }) => {
    const beta = await signedIn(browser, world.betaAdmin.email);
    for (const path of [`/app/organisations/${world.agencyId}/operations`, offerShiftPath]) {
      expect((await beta.goto(path))?.status(), path).toBe(404);
    }
    await beta.context().close();

    const wendy = await signedIn(browser, world.wendy.email);
    expect((await wendy.goto(`/app/organisations/${world.agencyId}/operations`))?.status()).toBe(
      404,
    );
    await wendy.goto(`/app/organisations/${world.agencyId}/my-shifts`);
    await expect(wendy.getByText("No shift offers right now.")).toBeVisible();
    await wendy.context().close();

    const facility = await signedIn(browser, world.facilityAdmin.email);
    expect((await facility.goto(`/app/organisations/${world.agencyId}/operations`))?.status()).toBe(
      404,
    );
    await facility.goto(`/app/organisations/${world.facilityOrgId}/staffing-requests`);
    await expect(
      facility.getByRole("heading", { level: 1, name: "Staffing requests" }),
    ).toBeVisible();
    await expect(facility.locator("main")).not.toContainText(/offer/i);
    await facility.context().close();
  });

  test("Flow 4: a suspended relationship blocks new offers and assignments and flags future work", async () => {
    const suspended = await world.admin.client.rpc("set_facility_relationship_status", {
      p_relationship_id: world.relationshipId,
      p_status: "suspended",
    });
    expect(suspended.error).toBeNull();

    await scheduler.goto(offerShiftPath);
    await expect(scheduler.getByText("Relationship not active", { exact: true })).toBeVisible();
    await expect(scheduler.getByRole("heading", { name: "Offer shift" })).toHaveCount(0);
    await expect(scheduler.getByRole("heading", { name: "Assign a worker" })).toHaveCount(0);

    const direct = await world.scheduler.client.rpc("offer_shift_to_workers", {
      p_shift_id: offerShiftPath.split("/").pop() ?? "",
      p_agency_worker_ids: [world.extra.omar?.workerId ?? ""],
    });
    expect(direct.error).toMatchObject({ code: "CHS10" });

    await scheduler.goto(`/app/organisations/${world.agencyId}/operations`);
    await expect(scheduler.getByRole("list", { name: "Affected upcoming shifts" })).toContainText(
      "Mercy Rehab",
    );
    await expect(
      scheduler.getByRole("list", { name: "Assignments needing attention" }),
    ).toContainText("Facility relationship not active");
  });
});
