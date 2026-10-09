import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import {
  documentCount,
  failWaitingScans,
  markUploadsClean,
  quarantineWaitingScans,
} from "../support/scanner";
import {
  agencyWorker,
  createStaffingWorld,
  facilityMember,
  isoDay,
  type Person,
  type StaffingWorld,
} from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn, SIGNED_IN_LANDING } from "./support";

/*
 * P0-E9-3C worker mobile recovery: worker entry polish, the organisation root,
 * the rebuilt credential flow and evidence upload (every outcome is real and
 * shown), and PWA activation (manifest, icons, a static-only service worker,
 * the offline page). Synthetic files only.
 */

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const AFTER_ACTION = { timeout: 20_000 };

const PDF = Buffer.from("%PDF-1.4\n% Chelth E2E evidence\n%%EOF\n");
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 2),
]);

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

async function openMore(page: Page) {
  await page
    .getByRole("navigation", { name: "Worker" })
    .getByRole("button", { name: "More" })
    .click();
  const sheet = page.getByRole("dialog", { name: "More" });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Step 1 of Add credential; returns on the new credential's record (step 2). */
async function addCredential(page: Page, base: string, type: string) {
  await page.goto(`${base}/my-credentials`);
  await page.getByRole("link", { name: "Add credential" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Add credential" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Add credential steps" })).toBeVisible();
  await page.getByRole("combobox", { name: "Credential type" }).selectOption({ label: type });
  await page.getByLabel("Issue date").fill(isoDay(-30));
  const expiry = page.getByLabel("Expiry date");
  if (await expiry.count()) await expiry.fill(isoDay(700));
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(/\/my-credentials\/[0-9a-f-]{36}$/, AFTER_ACTION);
  await expect(page.getByRole("heading", { level: 1, name: type })).toBeVisible();
}

async function pick(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.getByTestId("credential-file").setInputFiles({ name, mimeType, buffer });
}

test.describe.serial("worker mobile recovery (P0-E9-3C)", () => {
  test.setTimeout(240_000);

  let world: StaffingWorld;
  let betaName: string;
  let solo: Person;
  let duo: Person;
  let mixed: Person;
  let base: string;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    const tag = `rcv-${Date.now().toString(36)}`;
    world = await createStaffingWorld(tag);
    betaName = `Beta Agency ${tag}`;
    base = `/app/organisations/${world.agencyId}`;
    solo = await agencyWorker(world, "e2e-rcv-solo", "Sol Solo", "primary");
    duo = await agencyWorker(world, "e2e-rcv-duo", "Dua Duo", "primary");
    await agencyWorker(world, "", "", "beta", duo);
    mixed = await agencyWorker(world, "e2e-rcv-mixed", "Max Mixed", "primary");
    await facilityMember(world, "", "", "facility.supervisor", mixed);
  });

  test("entry: the agency root is not a worker home; staff keep their overview", async ({
    browser,
  }) => {
    const page = await signedIn(browser, solo.email);
    await page.goto(base);
    await expect(page).toHaveURL(new RegExp(`${base}/my-shifts$`));
    await expect(page.getByRole("heading", { name: "My worker record" })).toHaveCount(0);
    // The header mark opens My Shifts, not the organisation root.
    await expect(page.getByRole("banner").getByRole("link").first()).toHaveAttribute(
      "href",
      `${base}/my-shifts`,
    );
    await page.context().close();

    const admin = await signedIn(browser, world.admin.email);
    await admin.goto(base);
    await expect(admin).toHaveURL(new RegExp(`${base}$`));
    await expect(
      admin.getByRole("heading", { level: 1, name: "Operations Overview" }),
    ).toBeVisible();
    await admin.context().close();
  });

  test("entry: More fits the account — one agency, several agencies, mixed", async ({
    browser,
  }) => {
    // One agency: no chooser (it would only lead back here); Account, Security, Sign out stay.
    const page = await signedIn(browser, solo.email);
    let sheet = await openMore(page);
    await expect(sheet.getByRole("link", { name: "All workspaces" })).toHaveCount(0);
    await expect(sheet.getByRole("link", { name: "All agencies" })).toHaveCount(0);
    await expect(sheet.getByRole("link", { name: "Account" })).toHaveAttribute(
      "href",
      "/app/account",
    );
    await expect(sheet.getByRole("link", { name: "Security" })).toHaveAttribute(
      "href",
      "/app/security",
    );
    await expect(sheet.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(sheet).toContainText(`${world.agencyName} · Healthcare Worker`);
    await expect(sheet.getByText(`${world.agencyName} home`)).toHaveCount(0);
    await qaScreenshot(page, "e9-3c-more-single-agency");
    await expectNoA11yViolations(page);
    await page.context().close();

    // Several agencies: a worker-appropriate switch and "All agencies".
    const two = await signedIn(browser, duo.email);
    await two.getByRole("link", { name: `Open shifts with ${world.agencyName}` }).click();
    await expect(two).toHaveURL(new RegExp(`${base}/my-shifts$`), AFTER_ACTION);
    sheet = await openMore(two);
    await expect(sheet.getByRole("link", { name: "All agencies" })).toHaveAttribute("href", "/app");
    const switchList = sheet.getByRole("list", { name: "Switch agency" });
    await expect(switchList).toContainText(betaName);
    await switchList.getByRole("button", { name: new RegExp(betaName) }).click();
    await expect(two).toHaveURL(
      new RegExp(`/app/organisations/${world.betaId}/my-shifts$`),
      AFTER_ACTION,
    );
    await two.context().close();

    // Mixed (worker + facility supervisor): the general wording is unchanged.
    const both = await signedIn(browser, mixed.email);
    await both.goto(`${base}/my-shifts`);
    sheet = await openMore(both);
    await expect(sheet.getByRole("link", { name: "All workspaces" })).toHaveAttribute(
      "href",
      "/app",
    );
    await expect(sheet.getByRole("list", { name: "Switch workspace" })).toContainText(
      world.facilityOrgName,
    );
    await both.context().close();
  });

  test("credentials: add, refused files, PDF / JPG upload, duplicate tap, scanning → ready, submit", async ({
    browser,
  }) => {
    const page = await signedIn(browser, solo.email);
    await addCredential(page, base, "Basic Life Support (BLS)");
    const steps = page.getByRole("list", { name: "Add credential steps" });
    await expect(steps.locator('[aria-current="step"]')).toContainText("Evidence");
    const evidence = page.getByRole("region", { name: "Evidence" });
    const review = page.getByRole("region", { name: "Review and submit" });

    // No file: nothing to upload, and review cannot be submitted yet.
    await expect(evidence).toContainText("PDF, JPG or PNG · up to 10 MB");
    await expect(evidence.getByText("Choose document")).toBeVisible();
    await expect(evidence.getByRole("button", { name: "Upload evidence" })).toHaveCount(0);
    await expect(review).toContainText("Add evidence to continue.");
    await expect(page.getByRole("button", { name: "Submit for review" })).toHaveCount(0);
    // The native "Choose file / No file chosen" control is not shown.
    const input = page.getByTestId("credential-file");
    expect((await input.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
    await qaScreenshot(page, "e9-3c-evidence-empty");
    await expectNoA11yViolations(page);

    // Refused before upload: type, size, empty (nothing reaches storage).
    await pick(page, "notes.html", "text/html", Buffer.from("<p>hi</p>"));
    await expect(evidence.getByRole("alert")).toHaveText("Choose a PDF, JPG or PNG file.");
    await pick(page, "huge.pdf", "application/pdf", Buffer.alloc(10 * 1024 * 1024 + 1, 0x25));
    await expect(evidence.getByRole("alert")).toHaveText(
      "This file is larger than 10 MB. Choose a smaller file.",
    );
    await pick(page, "empty.pdf", "application/pdf", Buffer.alloc(0));
    await expect(evidence.getByRole("alert")).toHaveText(
      "This file is empty. Choose a different file.",
    );
    expect(await documentCount(solo.email)).toBe(0);

    // PDF: selected state, then one upload even when tapped twice.
    await pick(page, "bls-card.pdf", "application/pdf", PDF);
    await expect(evidence).toContainText("bls-card.pdf");
    await expect(evidence).toContainText("Ready to upload");
    await expect(evidence.getByText("Replace")).toBeVisible();
    await qaScreenshot(page, "e9-3c-evidence-selected");
    await evidence.getByRole("button", { name: "Upload evidence" }).dblclick();
    await expect(evidence).toContainText("Checking document…", AFTER_ACTION);
    expect(await documentCount(solo.email)).toBe(1);
    await expect(steps.locator('[aria-current="step"]')).toContainText("Review");
    await qaScreenshot(page, "e9-3c-evidence-checking");

    // Refresh: the real state persists (no client-only success).
    await page.reload();
    await expect(evidence).toContainText("Checking document…");

    // Content that is not what it claims: refused by the server, shown plainly.
    await pick(page, "fake.pdf", "application/pdf", Buffer.from("<html></html>"));
    await evidence.getByRole("button", { name: "Upload evidence" }).click();
    await expect(evidence.getByRole("alert")).toHaveText(
      "This document cannot be used. Upload a different file.",
      AFTER_ACTION,
    );

    // JPG (Photos) replaces it.
    await pick(page, "IMG_2041.jpg", "image/jpeg", JPG);
    await evidence.getByRole("button", { name: "Upload evidence" }).click();
    await expect(evidence).toContainText("Document uploaded. Checking document…", AFTER_ACTION);
    expect(await documentCount(solo.email)).toBe(3);

    // Scanner clears both: the page updates without a manual reload.
    expect(await markUploadsClean(solo.email)).toBe(2);
    await expect(evidence).toContainText("Document ready", { timeout: 20_000 });
    await expect(
      evidence.getByRole("button", { name: "Open document for version 1" }),
    ).toBeVisible();

    // Review summary, then submit.
    await expect(review).toContainText("Basic Life Support (BLS)");
    await expect(review).toContainText(`Shared with ${world.agencyName}`);
    await expect(review).toContainText("Document ready");
    await qaScreenshot(page, "e9-3c-review");
    await expectNoA11yViolations(page);
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByRole("main").locator("header")).toContainText("Submitted", AFTER_ACTION);
    await expect(page.getByRole("region", { name: `Review by ${world.agencyName}` })).toContainText(
      `Waiting for ${world.agencyName} to review it.`,
    );
    await qaScreenshot(page, "e9-3c-record-submitted");
    await page.context().close();
  });

  test("credentials: Android-style files, PNG, scan failure and quarantine are shown honestly", async ({
    browser,
  }) => {
    const page = await signedIn(browser, solo.email);
    await addCredential(page, base, "CPR certification");
    const evidence = page.getByRole("region", { name: "Evidence" });
    const before = await documentCount(solo.email);

    // Android document providers can report no MIME type: the extension decides.
    await pick(page, "cpr.pdf", "", PDF);
    await expect(evidence).toContainText("Ready to upload");
    await evidence.getByRole("button", { name: "Upload evidence" }).click();
    await expect(evidence).toContainText("Checking document…", AFTER_ACTION);

    // The scanner could not finish: still untrusted, said plainly.
    expect(await failWaitingScans(solo.email)).toBe(1);
    await page.reload();
    await expect(evidence).toContainText("We couldn't finish checking this document yet.");

    // A display name without an extension (Photos): the declared type decides. PNG.
    await pick(page, "1000012345", "image/png", PNG);
    await evidence.getByRole("button", { name: "Upload evidence" }).click();
    await expect(evidence).toContainText("Document uploaded. Checking document…", AFTER_ACTION);
    expect(await documentCount(solo.email)).toBe(before + 2);

    // Quarantined: never usable. The worker cannot read such a document (RLS), so it
    // leaves the page; while the page is open the worker is told why, in plain words.
    expect(await quarantineWaitingScans(solo.email)).toBe(2);
    await expect(evidence.getByRole("alert")).toHaveText(
      "This document cannot be used. Upload a different file.",
      { timeout: 20_000 },
    );
    await expect(evidence).toContainText("Upload evidence");
    await expect(page.getByRole("main")).not.toContainText(
      /malware|quarantin|provider|bucket|storage/i,
    );
    await expect(page.getByRole("button", { name: "Submit for review" })).toHaveCount(0);
    await page.context().close();
  });

  test("credentials: offline never uploads or claims success", async ({ browser }) => {
    const page = await signedIn(browser, solo.email);
    await addCredential(page, base, "TB screening");
    const evidence = page.getByRole("region", { name: "Evidence" });
    const before = await documentCount(solo.email);
    await pick(page, "tb.pdf", "application/pdf", PDF);
    await page.context().setOffline(true);
    await evidence.getByRole("button", { name: "Upload evidence" }).click();
    await expect(evidence.getByRole("alert")).toContainText("You're offline");
    await expect(evidence).toContainText("Ready to upload");
    await page.context().setOffline(false);
    expect(await documentCount(solo.email)).toBe(before);
    // Back online, the same selection uploads.
    await evidence.getByRole("button", { name: "Upload evidence" }).click();
    await expect(evidence).toContainText("Checking document…", AFTER_ACTION);
    expect(await documentCount(solo.email)).toBe(before + 1);
    await page.context().close();
  });

  test("worker pages stay a centred phone column; the bottom nav never covers actions", async ({
    browser,
  }) => {
    const page = await signedIn(browser, solo.email);
    const nav = page.getByRole("navigation", { name: "Worker" });
    await page.goto(`${base}/my-credentials`);
    const record = page
      .getByRole("list", { name: "My credentials" })
      .getByRole("link", { name: /Basic Life Support/ });
    const recordPath = await record.getAttribute("href");
    for (const width of [360, 375, 390, 412, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of [
        `${base}/my-shifts`,
        `${base}/timesheets`,
        `${base}/my-credentials`,
        `${base}/my-credentials/new`,
        recordPath ?? "",
      ]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        await expectNoPageOverflow(page);
        const column = await page.getByRole("main").locator(":scope > div").first().boundingBox();
        expect(column?.width ?? 0).toBeLessThanOrEqual(576);
        // Scrolled to the end, the last action sits above the bottom navigation.
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const last = page.getByRole("main").getByRole("button").last();
        if (await last.count()) {
          const [action, bar] = await Promise.all([last.boundingBox(), nav.boundingBox()]);
          if (action && bar) expect(action.y + action.height).toBeLessThanOrEqual(bar.y + 1);
        }
      }
      if (width === 375) {
        await page.goto(`${base}/my-credentials`);
        await qaScreenshot(page, "e9-3c-my-credentials");
        await expectNoA11yViolations(page);
        await page.goto(`${base}/my-credentials/new`);
        await qaScreenshot(page, "e9-3c-add-credential");
        await expectNoA11yViolations(page);
      }
    }
    await page.context().close();
  });

  test("PWA: manifest, icons and apple-touch-icon resolve", async ({ page, request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    const manifest = (await response.json()) as {
      name: string;
      short_name: string;
      start_url: string;
      scope: string;
      display: string;
      theme_color: string;
      background_color: string;
      icons: { src: string; sizes: string; type: string; purpose?: string }[];
    };
    expect(manifest).toMatchObject({
      name: "Chelth",
      short_name: "Chelth",
      start_url: "/app",
      scope: "/",
      display: "standalone",
      theme_color: "#126B67",
      background_color: "#FAFBFA",
    });
    for (const [sizes, purpose] of [
      ["192x192", "any"],
      ["512x512", "any"],
      ["192x192", "maskable"],
      ["512x512", "maskable"],
    ]) {
      const icon = manifest.icons.find((item) => item.sizes === sizes && item.purpose === purpose);
      expect(icon, `${sizes} ${purpose}`).toBeTruthy();
      const file = await request.get(icon?.src ?? "");
      expect(file.status()).toBe(200);
      expect(file.headers()["content-type"]).toContain("image/png");
    }
    // Worker routes are inside the scope.
    expect(`/app/organisations/${world.agencyId}/my-shifts`.startsWith(manifest.scope)).toBe(true);

    await page.goto("/sign-in");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );
    const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
    expect((await request.get(apple ?? "")).status()).toBe(200);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#126B67");

    const worker = await request.get("/sw.js");
    expect(worker.status()).toBe(200);
    expect(worker.headers()["content-type"]).toContain("javascript");
    expect(worker.headers()["cache-control"]).toContain("no-store");
    for (const path of ["/offline.html", "/offline.css"]) {
      expect((await request.get(path)).status()).toBe(200);
    }
  });

  test("PWA: the service worker registers and caches only static files", async ({ browser }) => {
    const page = await signedIn(browser, solo.email);
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(new URL(scope).pathname).toBe("/");
    // Use the worker app (pages, data, server actions, Supabase) under the service worker.
    await page.goto(`${base}/my-shifts`);
    await page.goto(`${base}/timesheets`);
    await page.goto(`${base}/my-credentials`);
    await page.getByRole("list", { name: "My credentials" }).getByRole("link").first().click();
    await expect(page).toHaveURL(/\/my-credentials\/[0-9a-f-]{36}$/);
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
      }
      return urls;
    });
    expect(cached.length).toBeGreaterThan(0);
    for (const url of cached) {
      const { origin, pathname, search } = new URL(url);
      expect(origin, url).toBe(new URL(page.url()).origin);
      expect(
        pathname.startsWith("/_next/static/") ||
          pathname.startsWith("/brand/chelth/") ||
          pathname === "/offline.html" ||
          pathname === "/offline.css",
        url,
      ).toBe(true);
      expect(search, url).not.toMatch(/token|_rsc/i);
    }
    // Nothing is kept in browser storage for convenience.
    const stored = await page.evaluate(() => [
      ...Object.keys(window.localStorage),
      ...Object.keys(window.sessionStorage),
    ]);
    expect(stored.filter((key) => /token|invite|signed|credential|sb-/i.test(key))).toEqual([]);
    await page.context().close();
  });

  test("PWA: offline navigation shows the honest offline page", async ({ browser }) => {
    const page = await signedIn(browser, solo.email);
    await page.evaluate(async () => navigator.serviceWorker.ready);
    // Ensure this page is controlled before going offline.
    await page.reload();
    await page.context().setOffline(true);
    await page.goto(`${base}/timesheets`).catch(() => null);
    await expect(page.getByRole("heading", { level: 1, name: "You're offline" })).toBeVisible();
    await expect(page.getByRole("main")).toContainText(
      "Nothing is saved or sent while you're offline.",
    );
    await page.context().setOffline(false);
    await page.getByRole("link", { name: "Try again" }).click();
    await expect(page).toHaveURL(SIGNED_IN_LANDING, AFTER_ACTION);
    await page.context().close();
  });
});
