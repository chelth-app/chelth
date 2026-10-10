import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";
import postgres from "postgres";

import { createStaffingWorld, isoDay, type StaffingWorld } from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn, SIGNED_IN_LANDING } from "./support";

/*
 * P0-E9-3D-S4 worker messaging in the worker app: Shift Details → Message
 * agency → a shift thread with context; sending (once per tap), unread
 * attention in More and Messages, reading, pagination, offline honesty,
 * and nothing about messages in the service worker caches.
 */

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const AFTER_ACTION = { timeout: 20_000 };
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";

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

async function messageCount(threadId: string): Promise<number> {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.messages where thread_id = ${threadId}::uuid`;
    return row?.n ?? 0;
  } finally {
    await sql.end();
  }
}

test.describe.serial("worker messaging (P0-E9-3D-S4)", () => {
  test.setTimeout(240_000);

  let world: StaffingWorld;
  let base: string;
  let threadId: string;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(300_000);
    world = await createStaffingWorld(`msg-${testInfo.project.name.split("-")[0] ?? "e2e"}`, [
      { key: "mia", name: "Mia Message", blsExpiryDays: 400 },
      { key: "ned", name: "Ned Nothing", blsExpiryDays: 400 },
    ]);
    base = `/app/organisations/${world.agencyId}`;
    const mia = world.extra.mia;
    if (!mia) throw new Error("fixture");
    const locations = await world.admin.client
      .from("facility_locations")
      .select("id")
      .eq("agency_facility_id", world.facilityId);
    if (locations.error) throw locations.error;
    const shift = await world.scheduler.client.rpc("create_shift", {
      p_agency_facility_id: world.facilityId,
      p_facility_location_id: locations.data[0]?.id ?? "",
      p_discipline_key: "cna",
      p_shift_date: isoDay(3),
      p_start_time: "07:00",
      p_end_time: "15:00",
      p_requested_headcount: 1,
      p_open: true,
    });
    if (shift.error) throw shift.error;
    const assigned = await world.scheduler.client.rpc("assign_worker_to_shift", {
      p_shift_id: shift.data,
      p_agency_worker_id: mia.workerId,
    });
    if (assigned.error) throw assigned.error;
  });

  test("Shift Details → Message agency opens a shift thread; one message per tap", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.extra.mia?.email ?? "");
    await page.goto(`${base}/my-shifts`);
    await page
      .getByRole("link", { name: /^Shift details: Mercy Rehab/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Message agency" }).click();
    await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}$/, AFTER_ACTION);
    threadId = page.url().split("/").pop() ?? "";
    await expect(page.getByRole("heading", { level: 1, name: world.agencyName })).toBeVisible();
    // Context header (tap → Shift Details).
    await expect(page.getByRole("link", { name: /^Shift details: Mercy Rehab/ })).toBeVisible();
    await expect(page.getByText("No messages yet.")).toBeVisible();
    await qaScreenshot(page, "e9-3d-thread-empty");
    await expectNoA11yViolations(page);

    const composer = page.getByLabel("Message", { exact: true });
    await composer.fill("Hi — where should I park on Thursday?");
    await page.getByRole("button", { name: "Send" }).dblclick();
    const messages = page.getByRole("list", { name: "Messages" });
    await expect(messages).toContainText("Hi — where should I park on Thursday?", AFTER_ACTION);
    await expect(messages).toContainText("You");
    await expect(composer).toHaveValue("");
    expect(await messageCount(threadId)).toBe(1);
    await page.context().close();
  });

  test("the agency's reply raises unread attention; reading clears it", async ({ browser }) => {
    const reply = await world.scheduler.client.rpc("send_message", {
      p_thread_id: threadId,
      p_body: "Use the visitor garage, level 2. Report through the east entrance.",
      p_client_key: crypto.randomUUID(),
    });
    if (reply.error) throw reply.error;

    const page = await signedIn(browser, world.extra.mia?.email ?? "");
    await page.goto(`${base}/my-shifts`);
    const more = page
      .getByRole("navigation", { name: "Worker" })
      .getByRole("button", { name: /^More/ });
    await expect(more).toHaveAccessibleName(/1 unread message/);
    await more.click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet.getByRole("link", { name: /Messages/ })).toContainText("1 unread");
    await sheet.getByRole("link", { name: /Messages/ }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/messages$`));
    await page
      .getByRole("navigation", { name: "Message filter" })
      .getByRole("link", { name: "Unread" })
      .click();
    const threads = page.getByRole("list", { name: "Message threads" });
    await expect(threads).toContainText(world.agencyName);
    await expect(threads).toContainText("Mercy Rehab");
    await expect(threads).toContainText("Use the visitor garage");
    await expect(threads).toContainText("1 unread");
    await qaScreenshot(page, "e9-3d-messages-unread");
    await expectNoA11yViolations(page);

    await threads.getByRole("link", { name: new RegExp(world.agencyName) }).click();
    const messages = page.getByRole("list", { name: "Messages" });
    await expect(messages).toContainText("Use the visitor garage, level 2.");
    // The agency appears by name — never a staff member's personal name.
    await expect(messages).toContainText(world.agencyName);
    await expect(messages).not.toContainText("Sam Scheduler");
    await qaScreenshot(page, "e9-3d-thread");
    await expectNoA11yViolations(page);
    // Marked read: the badge clears.
    await expect
      .poll(async () => {
        await page.goto(`${base}/messages?view=unread`);
        return page.getByText("No unread messages.").count();
      }, AFTER_ACTION)
      .toBe(1);
    await page.context().close();
  });

  test("offline: the message is not sent and the text is kept", async ({ browser }) => {
    const page = await signedIn(browser, world.extra.mia?.email ?? "");
    await page.goto(`${base}/messages/${threadId}`);
    const before = await messageCount(threadId);
    const composer = page.getByLabel("Message", { exact: true });
    await composer.fill("Are we still on for Thursday?");
    await page.context().setOffline(true);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "You're offline. Your message was not sent.",
    );
    await expect(composer).toHaveValue("Are we still on for Thursday?");
    await page.context().setOffline(false);
    expect(await messageCount(threadId)).toBe(before);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("list", { name: "Messages" })).toContainText(
      "Are we still on for Thursday?",
      AFTER_ACTION,
    );
    expect(await messageCount(threadId)).toBe(before + 1);
    await page.context().close();
  });

  test("long threads page: earlier messages on request", async ({ browser }) => {
    for (let index = 0; index < 32; index += 1) {
      const sent = await world.scheduler.client.rpc("send_message", {
        p_thread_id: threadId,
        p_body: `Update ${index + 1}`,
        p_client_key: crypto.randomUUID(),
      });
      if (sent.error) throw sent.error;
    }
    const page = await signedIn(browser, world.extra.mia?.email ?? "");
    await page.goto(`${base}/messages/${threadId}`);
    const messages = page.getByRole("list", { name: "Messages" });
    await expect(messages.getByRole("listitem")).toHaveCount(30);
    await expect(messages).toContainText("Update 32");
    await page.getByRole("link", { name: "Show earlier messages" }).click();
    await expect(page.getByRole("list", { name: "Messages" })).toContainText(
      "Hi — where should I park",
    );
    await page.context().close();
  });

  test("another worker cannot open the thread; an empty inbox can message the agency", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.extra.ned?.email ?? "");
    expect((await page.goto(`${base}/messages/${threadId}`))?.status()).toBe(404);
    await page.goto(`${base}/messages`);
    await expect(page.getByText("No messages yet.")).toBeVisible();
    await page.getByRole("button", { name: "Message your agency" }).click();
    await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}$/, AFTER_ACTION);
    await expect(page.getByText("General")).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("visitor garage");
    await page.context().close();
  });

  test("messages are never in the service worker caches or browser storage", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.extra.mia?.email ?? "");
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await page.goto(`${base}/messages`);
    await page.goto(`${base}/messages/${threadId}`);
    await expect(page.getByRole("list", { name: "Messages" })).toContainText("Update 32");
    const cached = await page.evaluate(async () => {
      const found: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const response = await cache.match(request);
          const text = response ? await response.clone().text() : "";
          if (request.url.includes("/messages") || text.includes("visitor garage")) {
            found.push(request.url);
          }
        }
      }
      return found;
    });
    expect(cached).toEqual([]);
    const stored = await page.evaluate(() =>
      JSON.stringify({ ...window.localStorage, ...window.sessionStorage }),
    );
    expect(stored).not.toContain("visitor garage");
    await page.context().close();
  });
});
