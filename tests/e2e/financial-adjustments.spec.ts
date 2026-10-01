import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";

import { zonedLocalToInstant } from "@/lib/domain/attendance";

import { generateTotp } from "../support/totp";
import {
  agencyMember,
  arrangePastWork,
  createStaffingWorld,
  type Person,
  type StaffingWorld,
} from "./staffing-fixture";
import { signIn } from "./support";

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const AFTER_ACTION = { timeout: 20_000 };
const TZ = "America/New_York";

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

async function ok(promise: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await promise;
  if (error) throw error;
}

function at(date: string, time: string): string {
  const instant = zonedLocalToInstant(date, time, TZ);
  if (!instant) throw new Error("bad local time");
  return instant;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function closedPeriodStart(): string {
  const date = new Date(Date.now() - 14 * 86_400_000);
  const isoDow = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (isoDow - 1));
  return date.toISOString().slice(0, 10);
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app$/, AFTER_ACTION);
  return page;
}

async function steppedUp(browser: Browser, who: Person, path: string): Promise<Page> {
  const page = await signedIn(browser, who.email);
  await page.goto(path);
  await page.getByRole("link", { name: "Verify now" }).click();
  await page.getByLabel("Authentication code").fill(generateTotp(who.totpSecret ?? ""));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`), AFTER_ACTION);
  return page;
}

async function downloaded(page: Page, button: Locator) {
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  const bytes = await readFile(await download.path());
  return { text: bytes.toString("utf8"), sha256: createHash("sha256").update(bytes).digest("hex") };
}

test.describe.serial("financial adjustments and controls", () => {
  test.setTimeout(240_000);

  let world: StaffingWorld;
  let fay: Person;
  let gus: Person;
  let relationshipId: string;
  let sheet: string;
  let rateCardId: string;
  let adjustmentPath: string;
  let invoiceAdjustmentPath: string;
  const ps = closedPeriodStart();

  async function revise(revision: number) {
    await ok(
      world.admin.client.rpc("reopen_timesheet", {
        p_timesheet_id: sheet,
        p_reason: "approved_in_error",
      }),
    );
    const tia = world.extra.tia;
    if (!tia) throw new Error("missing worker");
    await must(tia.client.rpc("submit_timesheet", { p_timesheet_id: sheet }));
    await must(
      world.admin.client.rpc("approve_timesheet", {
        p_timesheet_id: sheet,
        p_expected_revision: revision,
      }),
    );
    await must(
      world.admin.client.rpc("price_timesheet", {
        p_timesheet_id: sheet,
        p_expected_revision: revision,
      }),
    );
  }

  async function activeRate(card: string, pay: number, bill: number, from: string) {
    const version = await must(
      world.admin.client.rpc("create_rate_version", {
        p_rate_card_id: card,
        p_currency: "USD",
        p_pay_rate_minor: pay,
        p_bill_rate_minor: bill,
        p_effective_from: from,
      }),
    );
    await ok(world.admin.client.rpc("activate_rate_version", { p_version_id: version }));
  }

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`adj-${testInfo.project.name.split("-")[0] ?? "e2e"}`, [
      { key: "tia", name: "Tia Adjusted", blsExpiryDays: 400 },
    ]);
    [fay, gus] = await Promise.all([
      agencyMember(world, "e2e-fay", "Fay Finance", "agency.finance", true),
      agencyMember(world, "e2e-gus", "Gus Checker", "agency.finance", true),
    ]);
    const facilityId = await must(
      world.admin.client.rpc("create_agency_facility", {
        p_agency_organisation_id: world.agencyId,
        p_name: "Riverside Clinic",
        p_facility_type: "clinic",
        p_timezone: TZ,
      }),
    );
    const locationId = await must(
      world.admin.client.rpc("create_facility_location", {
        p_facility_id: facilityId,
        p_name: "Riverside Ward",
      }),
    );
    relationshipId = await must(
      world.admin.client.rpc("create_facility_relationship", { p_facility_id: facilityId }),
    );
    await ok(
      world.admin.client.rpc("set_facility_relationship_status", {
        p_relationship_id: relationshipId,
        p_status: "active",
      }),
    );
    rateCardId = await must(
      world.admin.client.rpc("create_rate_card", {
        p_organisation_id: world.agencyId,
        p_discipline_key: "cna",
        p_relationship_id: relationshipId,
      }),
    );
    await activeRate(rateCardId, 4250, 5800, addDays(ps, -30));
    const tia = world.extra.tia;
    if (!tia) throw new Error("missing worker");
    let assignmentId = "";
    for (const [day, out] of [
      [1, "17:00"],
      [2, "16:33"],
    ] as const) {
      const date = addDays(ps, day);
      assignmentId = (
        await arrangePastWork(world, {
          worker: tia,
          facilityId,
          locationId,
          startAt: at(date, "09:00"),
          endAt: at(date, "17:00"),
          events: [
            { type: "clock_in", at: at(date, "09:00") },
            { type: "clock_out", at: at(date, out) },
          ],
        })
      ).assignmentId;
    }
    const [entry] = await must(
      world.admin.client
        .from("timesheet_entries")
        .select("timesheet_id")
        .eq("assignment_id", assignmentId),
    );
    sheet = entry?.timesheet_id ?? "";
    await must(tia.client.rpc("submit_timesheet", { p_timesheet_id: sheet }));
    await must(
      world.admin.client.rpc("approve_timesheet", {
        p_timesheet_id: sheet,
        p_expected_revision: 1,
      }),
    );
    await must(
      world.admin.client.rpc("price_timesheet", { p_timesheet_id: sheet, p_expected_revision: 1 }),
    );

    // Original payroll batch and invoice draft, locked and exported (API, as Fay).
    const batch = await must(
      fay.client.rpc("create_payroll_batch", {
        p_organisation_id: world.agencyId,
        p_period_start: ps,
        p_currency: "USD",
      }),
    );
    await ok(fay.client.rpc("review_payroll_batch", { p_batch_id: batch }));
    await must(fay.client.rpc("approve_payroll_batch", { p_batch_id: batch }));
    await ok(fay.client.rpc("lock_payroll_batch", { p_batch_id: batch }));
    await must(fay.client.rpc("create_payroll_export", { p_batch_id: batch }));
    const draft = await must(
      fay.client.rpc("create_invoice_draft", {
        p_organisation_id: world.agencyId,
        p_relationship_id: relationshipId,
        p_period_start: ps,
        p_currency: "USD",
      }),
    );
    await ok(fay.client.rpc("review_invoice_draft", { p_draft_id: draft }));
    await must(fay.client.rpc("approve_invoice_draft", { p_draft_id: draft }));
    await ok(fay.client.rpc("lock_invoice_draft", { p_draft_id: draft }));

    // Revision 2: $44.00 / $60.00 from day 2.
    await activeRate(rateCardId, 4400, 6000, addDays(ps, 2));
    await revise(2);
  });

  test("Flow 1: a revised locked batch is adjusted — prepared, reviewed, approved and locked", async ({
    browser,
  }) => {
    const path = `/app/organisations/${world.agencyId}/payroll`;
    const page = await steppedUp(browser, fay, path);
    const required = page.getByRole("region", { name: "Payroll adjustments required" });
    await expect(required).toContainText("Ready to adjust");
    await expect(required).toContainText("Revision 1 → 2");
    await expect(required).toContainText("+$11.32");
    await expect(required).toContainText("Increase");
    await required
      .getByRole("button", { name: /^Prepare payroll adjustment for Tia Adjusted/ })
      .click();
    await expect(page).toHaveURL(/\/payroll\/adjustments\/[0-9a-f-]{36}$/, AFTER_ACTION);
    adjustmentPath = new URL(page.url()).pathname;
    await expect(page.getByText("Adjustment — not payment")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^PAY-ADJ-\d{4}-\d{6}$/);
    const lines = page.getByRole("region", { name: "Payroll adjustment lines" });
    await expect(lines).toContainText("$320.88 → $332.20");
    await expect(lines).toContainText("+$11.32");
    await page.getByRole("button", { name: "Mark reviewed" }).click();
    await page.getByRole("button", { name: "Approve adjustment" }).click();
    await page.getByRole("button", { name: "Lock adjustment" }).click();
    await expect(page.getByText("A locked adjustment never changes.")).toBeVisible(AFTER_ACTION);
    await expectNoA11yViolations(page);
    await page.context().close();
  });

  test("Flow 2: the payroll adjustment exports to CSV with a verifiable checksum", async ({
    browser,
  }) => {
    const page = await steppedUp(browser, fay, adjustmentPath);
    await page.getByRole("button", { name: "Export CSV" }).click();
    const exports = page.getByRole("region", { name: "Payroll adjustment exports" });
    await expect(exports).toContainText(/PAY-ADJ-\d{4}-\d{6}\.csv/, AFTER_ACTION);
    await expect(exports).toContainText("+$11.32");
    const checksum = (await exports.locator("details code").first().textContent()) ?? "";
    const file = await downloaded(
      page,
      exports.getByRole("button", { name: /^Download PAY-ADJ-/ }),
    );
    expect(file.sha256).toBe(checksum);
    expect(file.text.split("\r\n")[0]).toContain("delta_pay_amount_minor");
    expect(file.text).toContain(",32088,33220,1132,");
    await page.context().close();
  });

  test("Flow 3: the invoice adjustment is an additional charge with no pay data", async ({
    browser,
  }) => {
    const path = `/app/organisations/${world.agencyId}/invoices`;
    const page = await steppedUp(browser, fay, path);
    const required = page.getByRole("region", {
      name: "Invoice adjustments required for Riverside Clinic",
    });
    await expect(required).toContainText("+$15.10");
    await expect(required).toContainText("Additional charge");
    await required
      .getByRole("button", { name: /^Prepare invoice adjustment for Riverside Clinic/ })
      .click();
    await expect(page).toHaveURL(/\/invoices\/adjustments\/[0-9a-f-]{36}$/, AFTER_ACTION);
    invoiceAdjustmentPath = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^INV-ADJ-\d{4}-\d{6}$/);
    await expect(page.getByText("Draft invoice adjustment — internal, not sent")).toBeVisible();
    await expect(page.getByText("Additional charge").first()).toBeVisible();
    await expect(page.getByText(/\$42\.50|\$44\.00|\$11\.32/)).toHaveCount(0);
    await page.getByRole("button", { name: "Mark reviewed" }).click();
    await page.getByRole("button", { name: "Approve adjustment" }).click();
    await page.getByRole("button", { name: "Lock adjustment" }).click();
    await expect(page.getByRole("button", { name: "Export adjustment PDF" })).toBeVisible(
      AFTER_ACTION,
    );
    await expectNoA11yViolations(page);
    await page.context().close();
  });

  test("Flow 4 & 5: a third revision adjusts against the last accounted state; maker/checker needs a second approver", async ({
    browser,
  }) => {
    await ok(
      fay.client.rpc("set_financial_maker_checker", {
        p_organisation_id: world.agencyId,
        p_required: true,
      }),
    );
    // A more specific card lowers revision 3: $40.00 / $55.00 for regular shifts.
    const tierOne = await must(
      world.admin.client.rpc("create_rate_card", {
        p_organisation_id: world.agencyId,
        p_discipline_key: "cna",
        p_relationship_id: relationshipId,
        p_classification: "regular",
      }),
    );
    await activeRate(tierOne, 4000, 5500, addDays(ps, -30));
    await revise(3);

    const path = `/app/organisations/${world.agencyId}/payroll`;
    const page = await steppedUp(browser, fay, path);
    const required = page.getByRole("region", { name: "Payroll adjustments required" });
    await expect(required).toContainText("Revision 2 → 3");
    await expect(required).toContainText(/Last accounted in PAY-ADJ-\d{4}-\d{6}/);
    await expect(required).toContainText("−$50.20");
    await expect(required).toContainText("Decrease");
    await required
      .getByRole("button", { name: /^Prepare payroll adjustment for Tia Adjusted/ })
      .click();
    await expect(page).toHaveURL(/\/payroll\/adjustments\/[0-9a-f-]{36}$/, AFTER_ACTION);
    const secondPath = new URL(page.url()).pathname;
    await expect(page.getByText(/^Follows$/)).toBeVisible();
    await expect(page.getByText("−$50.20").first()).toBeVisible();
    await page.getByRole("button", { name: "Mark reviewed" }).click();
    await expect(
      page.getByText("You prepared this adjustment. A different finance member must approve it."),
    ).toBeVisible(AFTER_ACTION);
    await expect(page.getByRole("button", { name: "Approve adjustment" })).toHaveCount(0);
    await page.context().close();

    const checker = await steppedUp(browser, gus, secondPath);
    await checker.getByRole("button", { name: "Approve adjustment" }).click();
    await checker.getByRole("button", { name: "Lock adjustment" }).click();
    await expect(checker.getByText("A locked adjustment never changes.")).toBeVisible(AFTER_ACTION);
    const history = checker.getByRole("list", { name: "Payroll adjustment history" });
    await expect(history).toContainText("Fay Finance");
    await expect(history).toContainText("Gus Checker");
    await expectNoA11yViolations(checker);
    await checker.context().close();
  });

  test("Flow 6: workers, schedulers and facilities cannot reach adjustment routes", async ({
    browser,
  }) => {
    const tia = world.extra.tia;
    if (!tia) throw new Error("missing worker");
    for (const who of [tia, world.scheduler, world.facilityAdmin]) {
      const page = await signedIn(browser, who.email);
      for (const path of [adjustmentPath, invoiceAdjustmentPath]) {
        expect((await page.goto(path))?.status(), `${who.email} ${path}`).toBe(404);
      }
      await page.context().close();
    }
  });
});
