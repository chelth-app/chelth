import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import { zonedLocalToInstant } from "@/lib/domain/attendance";

import { generateTotp } from "../support/totp";
import {
  agencyMember,
  arrangePastWork,
  createStaffingWorld,
  type Person,
  type StaffingWorld,
} from "./staffing-fixture";
import { expectNoPageOverflow, expectNoPaymentVocabulary, qaScreenshot, signIn } from "./support";

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const AFTER_ACTION = { timeout: 20_000 };
const TZ = "America/New_York";

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
  expect(results.violations).toEqual([]);
  // P0-E8-S2: wide tables scroll inside their region, never the page (412 px on mobile).
  await expectNoPageOverflow(page);
}

async function must<T>(promise: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await promise;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("no data");
  return data;
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

/** Monday two weeks back: a closed period under the default week start. */
function closedPeriodStart(): string {
  const date = new Date(Date.now() - 14 * 86_400_000);
  const isoDow = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (isoDow - 1));
  return date.toISOString().slice(0, 10);
}

async function ok(promise: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await promise;
  if (error) throw error;
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app$/, AFTER_ACTION);
  return page;
}

async function downloadedText(page: Page, button: ReturnType<Page["getByRole"]>) {
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  const file = await download.path();
  const bytes = await readFile(file);
  return {
    name: download.suggestedFilename(),
    text: bytes.toString("utf8"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

test.describe.serial("payroll preparation and invoice drafting", () => {
  test.setTimeout(240_000);

  let world: StaffingWorld;
  let finance: Person;
  let riverside: { facilityId: string; locationId: string; relationshipId: string };
  let tiaSheet: string;
  let rateCardId: string;
  let batchPath: string;
  let draftPath: string;
  let exportId: string;
  const ps = closedPeriodStart();

  function person(key: string) {
    const who = world.extra[key];
    if (!who) throw new Error(`unknown worker ${key}`);
    return who;
  }

  async function workedWeek(
    key: string,
    shifts: { day: number; start: string; end: string; out?: string }[],
  ): Promise<string> {
    let assignmentId = "";
    for (const shift of shifts) {
      const date = addDays(ps, shift.day);
      assignmentId = (
        await arrangePastWork(world, {
          worker: person(key),
          facilityId: riverside.facilityId,
          locationId: riverside.locationId,
          startAt: at(date, shift.start),
          endAt: at(date, shift.end),
          events: [
            { type: "clock_in", at: at(date, shift.start) },
            { type: "clock_out", at: at(date, shift.out ?? shift.end) },
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
    const timesheetId = entry?.timesheet_id ?? "";
    await must(person(key).client.rpc("submit_timesheet", { p_timesheet_id: timesheetId }));
    await must(
      world.admin.client.rpc("approve_timesheet", {
        p_timesheet_id: timesheetId,
        p_expected_revision: 1,
      }),
    );
    await must(
      world.admin.client.rpc("price_timesheet", {
        p_timesheet_id: timesheetId,
        p_expected_revision: 1,
      }),
    );
    return timesheetId;
  }

  /** Finance in the browser, stepped up to AAL2 through the real verify page. */
  async function steppedUpFinance(browser: Browser, path: string): Promise<Page> {
    const page = await signedIn(browser, finance.email);
    await page.goto(path);
    await page.getByRole("link", { name: "Verify now" }).click();
    await qaScreenshot(page, "s7-mfa-verify");
    await page.getByLabel("Authentication code").fill(generateTotp(finance.totpSecret ?? ""));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`), AFTER_ACTION);
    return page;
  }

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`fn-${testInfo.project.name.split("-")[0] ?? "e2e"}`, [
      { key: "tia", name: "Tia Payroll", blsExpiryDays: 400 },
      { key: "bo", name: "Bo Payroll", blsExpiryDays: 400 },
    ]);
    finance = await agencyMember(world, "e2e-finance", "Fay Finance", "agency.finance", true);
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
    const relationshipId = await must(
      world.admin.client.rpc("create_facility_relationship", { p_facility_id: facilityId }),
    );
    await world.admin.client.rpc("set_facility_relationship_status", {
      p_relationship_id: relationshipId,
      p_status: "active",
    });
    riverside = { facilityId, locationId, relationshipId };
    rateCardId = await must(
      world.admin.client.rpc("create_rate_card", {
        p_organisation_id: world.agencyId,
        p_discipline_key: "cna",
        p_relationship_id: relationshipId,
      }),
    );
    const cardId = rateCardId;
    const versionId = await must(
      world.admin.client.rpc("create_rate_version", {
        p_rate_card_id: cardId,
        p_currency: "USD",
        p_pay_rate_minor: 4250,
        p_bill_rate_minor: 5800,
        p_effective_from: addDays(ps, -30),
      }),
    );
    await ok(world.admin.client.rpc("activate_rate_version", { p_version_id: versionId }));
    tiaSheet = await workedWeek("tia", [
      { day: 1, start: "09:00", end: "17:00" },
      { day: 2, start: "09:00", end: "17:00", out: "16:33" },
    ]);
    await workedWeek("bo", [{ day: 3, start: "09:00", end: "13:00" }]);
  });

  test("Flow 1: finance prepares a payroll batch, reviews exact totals, approves and locks it", async ({
    browser,
  }) => {
    const path = `/app/organisations/${world.agencyId}/payroll`;
    const page = await steppedUpFinance(browser, path);
    // P0-E8-S5: P3-F workspace — summary from real counts, Payroll | Invoices mode switch.
    await expect(page.getByRole("region", { name: "Payroll summary" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Finance", exact: true }).getByRole("link", {
        name: "Payroll",
      }),
    ).toHaveAttribute("aria-current", "page");
    await expectNoPaymentVocabulary(page);
    await qaScreenshot(page, "s5-payroll");
    const work = page.getByRole("region", { name: "Unprepared payroll work" });
    await expect(work).toContainText("$830.88");
    await work.getByRole("button", { name: /^Prepare payroll batch for/ }).click();
    await expect(page).toHaveURL(/\/payroll\/[0-9a-f-]{36}$/, AFTER_ACTION);
    batchPath = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^PAY-\d{4}-\d{6}$/);
    await expect(page.getByText("$830.88").first()).toBeVisible();
    const workers = page.getByRole("region", { name: "Worker totals table" });
    await expect(workers).toContainText("Tia Payroll");
    await expect(workers).toContainText("$660.88");
    await expect(workers).toContainText("Bo Payroll");
    await expect(workers).toContainText("$170.00");
    await page.getByRole("button", { name: "Mark reviewed" }).click();
    await page.getByRole("button", { name: "Approve batch" }).click();
    await page.getByRole("button", { name: "Lock batch" }).click();
    await expect(page.getByText("A locked batch never changes.")).toBeVisible(AFTER_ACTION);
    await expect(page.getByText("Locked", { exact: true }).first()).toBeVisible();
    await expectNoA11yViolations(page);
    await page.context().close();
  });

  test("Flow 2: the locked batch is exported to CSV and the export shows its checksum", async ({
    browser,
  }) => {
    const page = await steppedUpFinance(browser, batchPath);
    await page.getByRole("button", { name: "Export CSV" }).click();
    const exports = page.getByRole("region", { name: "Payroll exports" });
    await expect(exports).toContainText(/PAY-\d{4}-\d{6}\.csv/, AFTER_ACTION);
    await expect(exports).toContainText("At export: locked");
    await expect(exports).toContainText("Fay Finance");
    await expect(exports).toContainText("$830.88");
    const checksum = (await exports.locator("details code").first().textContent()) ?? "";
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
    const file = await downloadedText(
      page,
      exports.getByRole("button", { name: /^Download PAY-.*\(export 1\)$/ }),
    );
    expect(file.sha256).toBe(checksum);
    expect(file.name).toMatch(/^PAY-\d{4}-\d{6}\.csv$/);
    expect(file.text.split("\r\n")[0]).toBe(
      "batch_reference,worker_reference,worker_name,period_start,period_end,work_date,facility,discipline,regular_minutes,overtime_minutes,pay_rate_minor,pay_amount_minor,currency",
    );
    expect(file.text).toContain(",34000,");
    await expect(page.getByText("Exported", { exact: true }).first()).toBeVisible();
    await expectNoPaymentVocabulary(page);
    await qaScreenshot(page, "s5-payroll-batch");
    const exportRows = await must(
      finance.client
        .from("financial_exports")
        .select("id")
        .eq(
          "source_reference",
          (await page.getByRole("heading", { level: 1 }).textContent()) ?? "",
        ),
    );
    exportId = exportRows[0]?.id ?? "";
    await expectNoA11yViolations(page);

    // The batch list: status filter keeps URL state; Payroll Batch Details is inspection only.
    await page.goto(`/app/organisations/${world.agencyId}/payroll?status=exported`);
    const batches = page.getByRole("region", { name: "Payroll batches table" });
    await expect(
      page.getByRole("form", { name: "Filter payroll batches" }).getByRole("combobox", {
        name: "Batch status",
      }),
    ).toHaveValue("exported");
    const preview = batches
      .getByRole("button", { name: /^Payroll batch details for PAY-/ })
      .first();
    await preview.click();
    const drawer = page.getByRole("dialog", { name: "Payroll Batch Details" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Close details" })).toBeFocused();
    await expect(drawer).toContainText("Exported");
    await expect(drawer).toContainText("$830.88");
    await expect(drawer.getByRole("button", { name: /approve|lock|export/i })).toHaveCount(0);
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(preview).toBeFocused();
    await page.context().close();
  });

  test("Flow 3: billable work by facility becomes an approved, locked draft invoice", async ({
    browser,
  }) => {
    const path = `/app/organisations/${world.agencyId}/invoices`;
    const page = await steppedUpFinance(browser, path);
    await expect(page.getByRole("region", { name: "Invoice summary" })).toBeVisible();
    await expect(page.getByText("Internal drafts — not sent")).toBeVisible();
    await expectNoPaymentVocabulary(page);
    await qaScreenshot(page, "s5-invoices");
    const billable = page.getByRole("region", { name: "Billable invoice work" });
    await expect(billable).toContainText("$1,133.90");
    await billable
      .getByRole("button", { name: /^Create invoice draft for Riverside Clinic/ })
      .click();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/, AFTER_ACTION);
    draftPath = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^INV-DRAFT-\d{4}-\d{6}$/);
    await expect(page.getByText("Draft invoice — internal, not sent")).toBeVisible();
    await expect(page.getByText("$1,133.90").first()).toBeVisible();
    await page.getByRole("button", { name: "Mark reviewed" }).click();
    await page.getByRole("button", { name: "Approve draft" }).click();
    await page.getByRole("button", { name: "Lock draft" }).click();
    await expect(page.getByRole("button", { name: "Export draft PDF" })).toBeVisible(AFTER_ACTION);
    await expectNoA11yViolations(page);
    await page.context().close();
  });

  test("Flow 4: the draft invoice is exported and shows no pay values", async ({ browser }) => {
    const page = await steppedUpFinance(browser, draftPath);
    const lines = page.getByRole("region", { name: "Invoice draft lines" });
    await expect(lines).toContainText("$58.00/h");
    await expect(lines).not.toContainText("$42.50");
    await expect(page.getByText(/\$660\.88|\$340\.00|\$320\.88/)).toHaveCount(0);
    await page.getByRole("button", { name: "Export draft CSV" }).click();
    const exports = page.getByRole("region", { name: "Invoice draft exports" });
    await expect(exports).toContainText(/-DRAFT-INVOICE\.csv/, AFTER_ACTION);
    const csv = await downloadedText(
      page,
      exports.getByRole("button", { name: /^Download INV-DRAFT-.*\.csv \(export 1\)$/ }),
    );
    expect(csv.text.split("\r\n")[0]).toContain("bill_amount_minor");
    expect(csv.text).not.toMatch(/pay_|,4250,|,34000,|,32088,|,17000,/);
    await page.getByRole("button", { name: "Export draft PDF" }).click();
    await expect(exports).toContainText(/-DRAFT-INVOICE\.pdf/, AFTER_ACTION);
    await expectNoPaymentVocabulary(page);
    await qaScreenshot(page, "s5-invoice-draft");
    await expectNoA11yViolations(page);

    // Invoice Details on the list shows bill-side values only.
    await page.goto(`/app/organisations/${world.agencyId}/invoices`);
    const preview = page
      .getByRole("region", { name: "Invoice drafts table" })
      .getByRole("button", { name: /^Invoice details for INV-DRAFT-/ })
      .first();
    await preview.click();
    const drawer = page.getByRole("dialog", { name: "Invoice Details" });
    await expect(drawer).toContainText("$1,133.90");
    await expect(drawer).not.toContainText(/\$660\.88|\$340\.00|\$320\.88|margin/i);
    await page.keyboard.press("Escape");
    await expect(preview).toBeFocused();
    await page.context().close();
  });

  test("Flow 5 & 6: workers, schedulers and facilities cannot reach payroll or invoices", async ({
    browser,
    request,
  }) => {
    const paths = [
      `/app/organisations/${world.agencyId}/payroll`,
      `/app/organisations/${world.agencyId}/invoices`,
      batchPath,
      draftPath,
    ];
    for (const who of [person("tia"), world.scheduler, world.facilityAdmin]) {
      const page = await signedIn(browser, who.email);
      for (const path of paths) {
        expect((await page.goto(path))?.status(), `${who.email} ${path}`).toBe(404);
      }
      const download = await page.request.post(`/app/exports/${exportId}/download`, {
        headers: { origin: new URL(page.url()).origin },
      });
      expect(download.status(), `${who.email} download`).toBe(404);
      await page.context().close();
    }
    const facility = await signedIn(browser, world.facilityAdmin.email);
    for (const path of [
      `/app/organisations/${world.facilityOrgId}/payroll`,
      `/app/organisations/${world.facilityOrgId}/invoices`,
    ]) {
      expect((await facility.goto(path))?.status(), path).toBe(404);
    }
    await facility.context().close();
    // Signed out, or cross-site: refused before any data is read.
    const anonymous = await request.post(`/app/exports/${exportId}/download`, {
      headers: { origin: "http://localhost:3100" },
    });
    expect(anonymous.status()).toBe(401);
    const crossSite = await request.post(`/app/exports/${exportId}/download`, {
      headers: { origin: "https://attacker.example" },
    });
    expect(crossSite.status()).toBe(403);
  });

  test("Flow 7: a new priced revision leaves the locked batch intact and flags an adjustment", async ({
    browser,
  }) => {
    await ok(
      world.admin.client.rpc("reopen_timesheet", {
        p_timesheet_id: tiaSheet,
        p_reason: "approved_in_error",
      }),
    );
    await must(person("tia").client.rpc("submit_timesheet", { p_timesheet_id: tiaSheet }));
    await must(
      world.admin.client.rpc("approve_timesheet", {
        p_timesheet_id: tiaSheet,
        p_expected_revision: 2,
      }),
    );
    // A later rate version ($44.00 / $60.00 from day 2) makes revision 2 a real financial change.
    const later = await must(
      world.admin.client.rpc("create_rate_version", {
        p_rate_card_id: rateCardId,
        p_currency: "USD",
        p_pay_rate_minor: 4400,
        p_bill_rate_minor: 6000,
        p_effective_from: addDays(ps, 2),
      }),
    );
    await ok(world.admin.client.rpc("activate_rate_version", { p_version_id: later }));
    await must(
      world.admin.client.rpc("price_timesheet", {
        p_timesheet_id: tiaSheet,
        p_expected_revision: 2,
      }),
    );

    const page = await signedIn(browser, finance.email);
    await page.goto(batchPath);
    await expect(page.getByText("Adjustment required").first()).toBeVisible();
    await expect(page.getByText(/This batch stays exactly as approved/)).toBeVisible();
    await expect(page.getByText("$830.88").first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Payroll lines" })).toContainText(
      "Now revision 2",
    );
    await page.goto(`/app/organisations/${world.agencyId}/payroll`);
    const issues = page.getByRole("region", { name: "Payroll issues" });
    await expect(issues).toContainText("Adjustment required");
    await expect(issues).toContainText(/PAY-\d{4}-\d{6} \(exported\)/);
    await page.goto(draftPath);
    await expect(page.getByText("Adjustment required").first()).toBeVisible();
    await expect(page.getByText("$1,133.90").first()).toBeVisible();
    await expectNoA11yViolations(page);
    await page.context().close();
  });
  test("F2 visual: Payroll on the locked finance system — KPIs, drawer, record (P0-E8-F2)", async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name.startsWith("mobile"), "explicit widths below");
    const page = await signedIn(browser, finance.email);
    const path = `/app/organisations/${world.agencyId}/payroll`;
    for (const [width, height] of [
      [1512, 982],
      [1280, 900],
      [1024, 900],
      [768, 1024],
      [412, 915],
      [375, 812],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: "Payroll" })).toBeVisible();
      const summary = page.getByRole("region", { name: "Payroll summary" });
      for (const label of ["Needs Attention", "Ready to Prepare", "Awaiting Approval"]) {
        await expect(summary).toContainText(label);
      }
      await expect(summary.getByRole("link", { name: /Ready to Export/ })).toBeVisible();
      // Lifecycle labels only — preparation and export, never payment.
      const batches = page.getByRole("region", { name: "Payroll batches table" });
      await expect(batches).toContainText("Exported");
      await expect(batches).toContainText("Adjustment required");
      await expect(page.getByText("Preparation and export only", { exact: true })).toBeVisible();
      await expectNoPaymentVocabulary(page);
      await expectNoPageOverflow(page);
      await expectNoA11yViolations(page);
      await qaScreenshot(page, "f2-payroll");

      if (width === 1512 || width === 768) {
        // Payroll Batch Details: native dialog, focus in, Escape returns focus to the row.
        const trigger = batches
          .getByRole("button", { name: /^Payroll batch details for PAY-/ })
          .first();
        await trigger.click();
        const drawer = page.getByRole("dialog", { name: "Payroll Batch Details" });
        await expect(drawer).toBeVisible();
        await expect(drawer).toContainText("Maker-checker");
        await expect(drawer).toContainText("Not required");
        await expect(drawer.getByRole("tab", { name: "Workers" })).toBeVisible();
        await expect(drawer.getByRole("button", { name: /approve|lock|export/i })).toHaveCount(0);
        await expectNoA11yViolations(page);
        await qaScreenshot(page, "f2-payroll-drawer");
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();

        // The batch record on the canonical record arrangement; Finance › Payroll stays current.
        await page.goto(batchPath);
        await expect(
          page
            .getByRole("navigation", { name: "Finance", exact: true })
            .getByRole("link", { name: "Payroll" }),
        ).toHaveAttribute("aria-current", "page");
        if (width >= 1024) {
          await expect(
            page
              .getByRole("navigation", { name: "Workspace" })
              .getByRole("link", { name: "Finance" }),
          ).toHaveAttribute("aria-current", "page");
        }
        await expect(
          page.getByRole("navigation", { name: "Payroll batch sections" }),
        ).toBeVisible();
        await expect(page.getByRole("region", { name: "Summary", exact: true })).toContainText(
          "$830.88",
        );
        await expect(page.getByLabel("Batch lifecycle")).toContainText("Fay Finance");
        await expectNoPaymentVocabulary(page);
        await expectNoPageOverflow(page);
        await expectNoA11yViolations(page);
        await qaScreenshot(page, "f2-payroll-record");
      }
    }
    // An invoice record keeps Finance › Invoices current (P0-E8-F2.5).
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto(draftPath);
    await expect(
      page
        .getByRole("navigation", { name: "Finance", exact: true })
        .getByRole("link", { name: "Invoices" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Finance" }),
    ).toHaveAttribute("aria-current", "page");
    await page.context().close();
  });
  test("F3 visual: Invoices on the locked finance system — KPIs, drawer, record (P0-E8-F3)", async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name.startsWith("mobile"), "explicit widths below");
    const page = await signedIn(browser, finance.email);
    const path = `/app/organisations/${world.agencyId}/invoices`;
    const financeNav = page.getByRole("navigation", { name: "Finance", exact: true });
    for (const [width, height] of [
      [1512, 982],
      [1280, 900],
      [1024, 900],
      [768, 1024],
      [412, 915],
      [375, 812],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: "Invoices" })).toBeVisible();
      // Inside the locked Finance shell: Invoices current, Finance current in the sidebar.
      await expect(financeNav.getByRole("link", { name: "Invoices" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      if (width >= 1024) {
        await expect(
          page
            .getByRole("navigation", { name: "Workspace" })
            .getByRole("link", { name: "Finance" }),
        ).toHaveAttribute("aria-current", "page");
      }
      const summary = page.getByRole("region", { name: "Invoice summary" });
      for (const label of ["Needs Attention", "Ready to Draft", "Awaiting Approval"]) {
        await expect(summary).toContainText(label);
      }
      await expect(summary.getByRole("link", { name: /Ready to Export/ })).toBeVisible();
      const drafts = page.getByRole("region", { name: "Invoice drafts table" });
      await expect(drafts).toContainText(/INV-DRAFT-\d{4}-\d{6}/);
      await expect(drafts).toContainText("Exported");
      await expect(page.getByText("Internal drafts — not sent", { exact: true })).toBeVisible();
      await expectNoPaymentVocabulary(page);
      await expectNoPageOverflow(page);
      await expectNoA11yViolations(page);
      await qaScreenshot(page, "f3-invoices");

      if (width === 1512 || width === 768) {
        // Invoice Details: identity, status, bill side only, no lifecycle buttons; Escape returns focus.
        const trigger = drafts
          .getByRole("button", { name: /^Invoice details for INV-DRAFT-/ })
          .first();
        await trigger.click();
        const drawer = page.getByRole("dialog", { name: "Invoice Details" });
        await expect(drawer).toBeVisible();
        await expect(drawer).toContainText(/INV-DRAFT-\d{4}-\d{6}/);
        await expect(drawer).toContainText("Riverside Clinic");
        await expect(drawer).toContainText("Exported");
        await expect(drawer).toContainText("$1,133.90");
        await expect(drawer).not.toContainText(/\$660\.88|\$340\.00|\$320\.88|margin|pay rate/i);
        await expect(drawer.getByRole("button", { name: /approve|lock|export|void/i })).toHaveCount(
          0,
        );
        await expect(drawer.getByRole("tab", { name: "Lines" })).toBeVisible();
        await expectNoA11yViolations(page);
        await qaScreenshot(page, "f3-invoice-drawer");
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();

        // The draft record on the canonical record arrangement.
        await page.goto(draftPath);
        await expect(financeNav.getByRole("link", { name: "Invoices" })).toHaveAttribute(
          "aria-current",
          "page",
        );
        await expect(
          page.getByRole("navigation", { name: "Invoice draft sections" }),
        ).toBeVisible();
        await expect(page.getByRole("region", { name: "Summary", exact: true })).toContainText(
          "$1,133.90",
        );
        await expect(page.getByLabel("Draft lifecycle")).toContainText("Fay Finance");
        await expect(page.getByText("Draft invoice — internal, not sent")).toBeVisible();
        await expect(page.getByRole("main")).not.toContainText(/margin|pay rate/i);
        await expectNoPaymentVocabulary(page);
        await expectNoPageOverflow(page);
        await expectNoA11yViolations(page);
        await qaScreenshot(page, "f3-invoice-record");
      }
    }
    await page.context().close();
  });
  test("F3.1: the current Finance tab is visible on narrow screens, routes and records included", async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name.startsWith("mobile"), "explicit widths below");
    const page = await signedIn(browser, finance.email);
    const base = `/app/organisations/${world.agencyId}`;
    const row = page.getByRole("navigation", { name: "Finance", exact: true });
    const expectCurrentVisible = async (area: string) => {
      await expect(row.locator('[aria-current="page"]')).toHaveCount(1);
      const current = row.getByRole("link", { name: area });
      await expect(current).toHaveAttribute("aria-current", "page");
      const [rowBox, tabBox] = await Promise.all([row.boundingBox(), current.boundingBox()]);
      if (!rowBox || !tabBox) throw new Error("Finance navigation is not rendered");
      expect(tabBox.x).toBeGreaterThanOrEqual(rowBox.x - 1);
      expect(tabBox.x + tabBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
    };

    for (const [width, height] of [
      [375, 812],
      [412, 915],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const [path, area] of [
        [`${base}/invoices`, "Invoices"],
        [draftPath, "Invoices"],
        [`${base}/payroll`, "Payroll"],
        [batchPath, "Payroll"],
        [`${base}/rates`, "Rates"],
      ] as const) {
        await page.goto(path);
        await expectCurrentVisible(area);
        await expectNoPageOverflow(page);
      }
      // Client-side navigation through the tabs keeps the new area in view.
      for (const area of ["Pricing", "Payroll", "Invoices"]) {
        await row.getByRole("link", { name: area }).click();
        await expect(page).toHaveURL(new RegExp(`/${area.toLowerCase()}$`));
        await expectCurrentVisible(area);
      }
      // The row stays manually scrollable; only the row moved, never the page.
      expect(await page.evaluate(() => window.scrollX)).toBe(0);
      const scroll = await row.evaluate((element) => {
        const before = element.scrollLeft;
        element.scrollLeft = 0;
        return {
          before,
          after: element.scrollLeft,
          scrollable: element.scrollWidth > element.clientWidth,
        };
      });
      expect(scroll.scrollable).toBe(true);
      expect(scroll.before).toBeGreaterThan(0);
      expect(scroll.after).toBe(0);
      // Keyboard focus still moves between tabs.
      await row.getByRole("link", { name: "Payroll" }).focus();
      await page.keyboard.press("Tab");
      await expect(row.getByRole("link", { name: "Invoices" })).toBeFocused();
      await expectNoA11yViolations(page);
      await qaScreenshot(page, "f31-finance-invoices");
    }

    // Desktop: everything already fits, so the row is never scrolled.
    await page.setViewportSize({ width: 1512, height: 982 });
    for (const path of [`${base}/pricing`, `${base}/invoices`]) {
      await page.goto(path);
      expect(await row.evaluate((element) => element.scrollLeft)).toBe(0);
    }

    // P0-E8-A1.2: shared SectionTabs rows carry no scrollbar chrome and cannot scroll
    // vertically (the 1 px content overflow was the right-edge artifact), yet still
    // scroll horizontally.
    const tabRowMetrics = (label: string) =>
      page.getByRole("navigation", { name: label, exact: true }).evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          scrollbarWidth: style.scrollbarWidth,
          scrollable: element.scrollWidth > element.clientWidth,
          gutter: (element as HTMLElement).offsetWidth - element.clientWidth,
        };
      });
    for (const [path, label] of [
      [batchPath, "Payroll batch sections"],
      [draftPath, "Invoice draft sections"],
      [`${base}/pricing`, "Pricing queues"],
      [`${base}/pricing`, "Finance"],
    ] as const) {
      await page.goto(path);
      const metrics = await tabRowMetrics(label);
      expect(metrics, `${label} at 1512`).toMatchObject({
        overflowX: "auto",
        overflowY: "hidden",
        scrollbarWidth: "none",
        gutter: 0,
      });
    }
    // Narrow: the record tabs overflow and still scroll by hand; focus stays reachable.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(batchPath);
    const sections = page.getByRole("navigation", { name: "Payroll batch sections" });
    expect((await tabRowMetrics("Payroll batch sections")).scrollable).toBe(true);
    expect(
      await sections.evaluate((element) => {
        element.scrollLeft = 200;
        return element.scrollLeft;
      }),
    ).toBeGreaterThan(0);
    await sections.getByRole("link", { name: "History" }).focus();
    await expect(sections.getByRole("link", { name: "History" })).toBeFocused();
    await expectNoPageOverflow(page);
    await expectNoA11yViolations(page);
    await page.context().close();
  });
});
