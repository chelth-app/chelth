import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";
import postgres from "postgres";

import { generateTotp } from "../support/totp";
import {
  agencyMember,
  createStaffingWorld,
  facilityMember,
  isoDay,
  type Person,
  type StaffingWorld,
} from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn, SIGNED_IN_LANDING } from "./support";

/*
 * P0-E9-3D-S5 staff messaging: agency staff message a worker from the worker
 * record and an assigned shift; facility staff message the agency from a
 * staffing request; replies, unread state, context links, history after the
 * shift closes, and narrow access (no capability / other tenant ⇒ 404).
 */

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const AFTER_ACTION = { timeout: 20_000 };

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

async function send(page: Page, text: string) {
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("list", { name: "Messages" })).toContainText(text, AFTER_ACTION);
}

test.describe.serial("staff messaging (P0-E9-3D-S5)", () => {
  test.setTimeout(240_000);

  let world: StaffingWorld;
  let finance: Person;
  let supervisor: Person;
  let shiftId: string;
  let wendyWorkerId: string;
  let workerThread: string;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(300_000);
    world = await createStaffingWorld(`smsg-${testInfo.project.name.split("-")[0] ?? "e2e"}`);
    finance = await agencyMember(world, "e2e-smsg-finance", "Fin Finance", "agency.finance");
    supervisor = await facilityMember(
      world,
      "e2e-smsg-sup",
      "Sue Supervisor",
      "facility.supervisor",
    );
    const workers = await world.wendy.client
      .from("agency_workers")
      .select("id")
      .eq("agency_organisation_id", world.agencyId);
    if (workers.error) throw workers.error;
    wendyWorkerId = workers.data[0]?.id ?? "";
    const locations = await world.admin.client
      .from("facility_locations")
      .select("id")
      .eq("agency_facility_id", world.facilityId);
    if (locations.error) throw locations.error;
    const shift = await world.scheduler.client.rpc("create_shift", {
      p_agency_facility_id: world.facilityId,
      p_facility_location_id: locations.data[0]?.id ?? "",
      p_discipline_key: "cna",
      p_shift_date: isoDay(2),
      p_start_time: "07:00",
      p_end_time: "15:00",
      p_requested_headcount: 1,
      p_open: true,
    });
    if (shift.error) throw shift.error;
    shiftId = shift.data;
    const assigned = await world.scheduler.client.rpc("assign_worker_to_shift", {
      p_shift_id: shiftId,
      p_agency_worker_id: wendyWorkerId,
    });
    if (assigned.error) throw assigned.error;
  });

  test("agency: Messages in the navigation; message a worker from their record", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.admin.email);
    const base = `/app/organisations/${world.agencyId}`;
    await page.goto(`${base}/workforce/${wendyWorkerId}`);
    // Messaging needs no step-up; the record itself may ask for it for other actions.
    if (await page.getByRole("link", { name: "Verify now" }).count()) {
      await page.getByRole("link", { name: "Verify now" }).first().click();
      await page.getByLabel("Authentication code").fill(generateTotp(world.admin.totpSecret ?? ""));
      await page.getByRole("button", { name: "Verify" }).click();
      await expect(page).toHaveURL(new RegExp(`/workforce/${wendyWorkerId}$`), AFTER_ACTION);
    }
    await page.getByRole("button", { name: "Message worker" }).click();
    await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]{36}$/, AFTER_ACTION);
    await expect(page.getByRole("heading", { level: 1, name: "Wendy Ready" })).toBeVisible();
    await send(page, "Hi Wendy — can you confirm your BLS card is current?");
    await expect(page.getByRole("list", { name: "Messages" })).toContainText("You");
    await qaScreenshot(page, "e9-3d-staff-conversation");
    await expectNoA11yViolations(page);
    await page.context().close();
  });

  test("agency: message an assigned worker about the shift; the worker replies; unread shows", async ({
    browser,
  }, testInfo) => {
    const page = await signedIn(browser, world.scheduler.email);
    const base = `/app/organisations/${world.agencyId}`;
    await page.goto(`${base}/shifts/${shiftId}`);
    await page.getByRole("button", { name: "Message Wendy Ready" }).click();
    await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]{36}$/, AFTER_ACTION);
    workerThread = page.url().split("/").pop() ?? "";
    // Context links back to the agency's own shift record.
    await expect(page.getByRole("link", { name: /Mercy Rehab/ })).toHaveAttribute(
      "href",
      `${base}/shifts/${shiftId}`,
    );
    await send(page, "Thursday is confirmed. Report to the ward desk.");

    const reply = await world.wendy.client.rpc("send_message", {
      p_thread_id: workerThread,
      p_body: "Thanks, I'll be there at 6:45.",
      p_client_key: crypto.randomUUID(),
    });
    if (reply.error) throw reply.error;

    await page.goto(`${base}/conversations`);
    if (testInfo.project.name.startsWith("desktop")) {
      // On phones the workspace navigation sits in the menu overlay.
      const nav = page.getByRole("navigation", { name: "Workspace" });
      await expect(nav.getByRole("link", { name: "Messages" }).first()).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
    await page
      .getByRole("navigation", { name: "Message filter" })
      .getByRole("link", { name: "Unread" })
      .click();
    const list = page.getByRole("list", { name: "Conversations" });
    await expect(list).toContainText("Wendy Ready");
    await expect(list).toContainText("Thanks, I'll be there at 6:45.");
    await expect(list).toContainText("1 unread");
    await qaScreenshot(page, "e9-3d-staff-inbox");
    await expectNoA11yViolations(page);
    await page.goto(`${base}/conversations/${workerThread}`);
    await expect(page.getByRole("list", { name: "Messages" })).toContainText("Wendy Ready");
    // Reading clears this thread from Unread (the admin's separate thread may remain).
    await expect
      .poll(async () => {
        await page.goto(`${base}/conversations?view=unread`);
        return (await page.getByRole("main").textContent())?.includes("6:45") ?? true;
      }, AFTER_ACTION)
      .toBe(false);
    await page.context().close();
  });

  test("facility: message the agency from a staffing request; the agency replies by name", async ({
    browser,
  }) => {
    const facility = await signedIn(browser, world.facilityAdmin.email);
    const fbase = `/app/organisations/${world.facilityOrgId}`;
    await facility.goto(`${fbase}/staffing-requests/${shiftId}`);
    await facility.getByRole("button", { name: "Message agency" }).click();
    await expect(facility).toHaveURL(/\/conversations\/[0-9a-f-]{36}$/, AFTER_ACTION);
    const facilityThread = facility.url().split("/").pop() ?? "";
    await expect(facility.getByRole("heading", { level: 1, name: world.agencyName })).toBeVisible();
    await send(facility, "Can the worker bring their own badge reel?");
    await expectNoA11yViolations(facility);

    const agency = await signedIn(browser, world.scheduler.email);
    await agency.goto(`/app/organisations/${world.agencyId}/conversations/${facilityThread}`);
    await expect(agency.getByRole("heading", { level: 1, name: "Mercy Rehab" })).toBeVisible();
    await expect(agency.getByRole("list", { name: "Messages" })).toContainText(
      world.facilityOrgName,
    );
    await send(agency, "Yes — we'll let her know.");
    await agency.context().close();

    await facility.reload();
    const messages = facility.getByRole("list", { name: "Messages" });
    await expect(messages).toContainText("Yes — we'll let her know.");
    // The facility sees the agency by organisation name, never staff names.
    await expect(messages).toContainText(world.agencyName);
    await expect(messages).not.toContainText("Sam Scheduler");
    // The facility never sees worker threads.
    expect((await facility.goto(`${fbase}/conversations/${workerThread}`))?.status()).toBe(404);
    await facility.goto(`${fbase}/conversations`);
    await expect(facility.getByRole("list", { name: "Conversations" })).not.toContainText("Wendy");
    await facility.context().close();
  });

  test("narrow access: no capability or another tenant ⇒ no Messages and 404", async ({
    browser,
  }) => {
    for (const [who, org] of [
      [finance, world.agencyId],
      [supervisor, world.facilityOrgId],
    ] as const) {
      const page = await signedIn(browser, who.email);
      await page.goto(`/app/organisations/${org}`);
      await expect(
        page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Messages" }),
      ).toHaveCount(0);
      expect((await page.goto(`/app/organisations/${org}/conversations`))?.status()).toBe(404);
      await page.context().close();
    }
    const beta = await signedIn(browser, world.betaAdmin.email);
    expect(
      (
        await beta.goto(`/app/organisations/${world.betaId}/conversations/${workerThread}`)
      )?.status(),
    ).toBe(404);
    await beta.goto(`/app/organisations/${world.betaId}/conversations`);
    await expect(beta.getByRole("main")).not.toContainText("Wendy");
    await beta.context().close();
  });

  test("history stays after the shift is completed", async ({ browser }) => {
    // Owner arrangement (local only): the shift is marked completed.
    const sql = postgres(
      process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres",
      { max: 1 },
    );
    try {
      await sql`update public.shifts set status = 'completed', completed_at = now() where id = ${shiftId}::uuid`;
      const [row] = await sql<
        { status: string }[]
      >`select status::text from public.shifts where id = ${shiftId}::uuid`;
      expect(row?.status).toBe("completed");
    } finally {
      await sql.end();
    }
    const page = await signedIn(browser, world.scheduler.email);
    await page.goto(`/app/organisations/${world.agencyId}/conversations/${workerThread}`);
    await expect(page.getByRole("list", { name: "Messages" })).toContainText(
      "Thursday is confirmed. Report to the ward desk.",
    );
    await expect(page.getByRole("list", { name: "Messages" })).toContainText(
      "Thanks, I'll be there at 6:45.",
    );
    await page.context().close();
  });
});
