import AxeBuilder from "@axe-core/playwright";
import {
  type Browser,
  expect,
  type Locator,
  type Page,
  test,
  type TestInfo,
} from "@playwright/test";

import {
  agencyMember,
  createStaffingWorld,
  facilityMember,
  type Person,
  type StaffingWorld,
} from "./staffing-fixture";
import { expectNoPageOverflow, qaScreenshot, signIn } from "./support";

/*
 * P0-E8-S1 shared Agency / Facility workspace shell: capability-driven
 * navigation, workspace switching, narrow-viewport overlay and the worker
 * separation. Selectors are semantic (roles and accessible names).
 */

const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const SCREENSHOTS = process.env.SHELL_SCREENSHOTS_DIR;

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
  expect(results.violations).toEqual([]);
  // P0-E8-S2: wide tables scroll inside their region, never the page (412 px on mobile).
  await expectNoPageOverflow(page);
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app$/);
  return page;
}

const isMobile = (testInfo: TestInfo) => testInfo.project.name.startsWith("mobile");

/**
 * The workspace navigation landmark: the persistent sidebar on desktop, or the
 * overlay opened from the top-bar trigger on narrow viewports.
 */
async function openWorkspaceNav(page: Page, testInfo: TestInfo): Promise<Locator> {
  if (isMobile(testInfo)) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    const dialog = page.getByRole("dialog", { name: "Workspace navigation" });
    await expect(dialog).toBeVisible();
    return dialog.getByRole("navigation", { name: "Workspace" });
  }
  const nav = page.getByRole("navigation", { name: "Workspace" });
  await expect(nav).toBeVisible();
  return nav;
}

async function closeWorkspaceNav(page: Page, testInfo: TestInfo) {
  if (isMobile(testInfo)) await page.keyboard.press("Escape");
}

async function navLabels(nav: Locator): Promise<string[]> {
  return (await nav.getByRole("link").allInnerTexts()).map((text) => text.trim());
}

async function expectNoInventedChrome(page: Page) {
  // Decision F10: no fake search, no fake notification bell; F6: no invented routes.
  // (Settings is a real route since P0-E8-S9H and is asserted through the navigation.)
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.getByPlaceholder(/search/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /notification/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /notification/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^reports?$/i })).toHaveCount(0);
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  if (!SCREENSHOTS) return;
  await page.screenshot({
    path: `${SCREENSHOTS}/${testInfo.project.name}-${name}.png`,
    fullPage: false,
  });
}

const AGENCY_ADMIN_NAV = [
  "Overview",
  "Operations",
  "Shifts",
  "Attendance",
  "Timesheets",
  "Workforce",
  "Facilities",
  "Compliance",
  "Finance",
  "Settings",
];

const FINANCE_AREAS = ["Rates", "Pricing", "Payroll", "Invoices"];

test.describe.serial("workspace shell", () => {
  test.setTimeout(240_000);

  let world: StaffingWorld;
  let finance: Person;
  let supervisor: Person;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`shell-${testInfo.project.name.split("-")[0] ?? "e2e"}`);
    finance = await agencyMember(world, "e2e-shell-finance", "Fran Finance", "agency.finance");
    // Fran also belongs to the facility, so she has a workspace to switch to.
    await facilityMember(world, "", "", "facility.scheduler", finance);
    supervisor = await facilityMember(
      world,
      "e2e-shell-supervisor",
      "Sue Supervisor",
      "facility.supervisor",
    );
  });

  test("agency admin: full capability navigation, Overview current, no invented chrome", async ({
    browser,
  }, testInfo) => {
    const page = await signedIn(browser, world.admin.email);
    await page.goto(`/app/organisations/${world.agencyId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Operations Overview" }),
    ).toBeVisible();
    await expect(page.getByRole("banner")).toContainText(world.agencyName);

    const nav = await openWorkspaceNav(page, testInfo);
    expect(await navLabels(nav)).toEqual(AGENCY_ADMIN_NAV);
    await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Canonical reverse lockup at the top of the sidebar (desktop) / overlay (narrow).
    const logoScope = isMobile(testInfo)
      ? page.getByRole("dialog", { name: "Workspace navigation" })
      : page.getByRole("complementary", { name: "Workspace sidebar" });
    await expect(logoScope.getByRole("img", { name: /Chelth/ })).toHaveAttribute(
      "src",
      "/brand/chelth/logo-reverse.svg",
    );
    await screenshot(page, testInfo, "agency-admin-overview");
    await closeWorkspaceNav(page, testInfo);

    await expectNoInventedChrome(page);
    await expectNoA11yViolations(page);

    // P0-E8-S2 Overview cleanup: the section link grid no longer repeats the sidebar.
    await expect(page.getByRole("navigation", { name: "Organisation sections" })).toHaveCount(0);
    for (const label of AGENCY_ADMIN_NAV.slice(1)) {
      await expect(
        page.getByRole("main").getByRole("link", { name: label, exact: true }),
      ).toHaveCount(0);
    }
    await qaScreenshot(page, "overview-after-cleanup");
    // P0-E8-S9H: administration moved to Settings → Team & Permissions
    // (privileged sections such as Invitations wait for MFA step-up, as before).
    await expect(page.getByRole("region", { name: "Members table" })).toHaveCount(0);
    await page.goto(`/app/organisations/${world.agencyId}/settings/team`);
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Members table" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Verify now" })).toBeVisible();
    await expectNoA11yViolations(page);

    // Representative finance page on the shared primitives: route tabs + empty state.
    await page.goto(`/app/organisations/${world.agencyId}/pricing?state=priced`);
    await expect(page.getByRole("heading", { level: 1, name: "Pricing" })).toBeVisible();
    const queues = page.getByRole("navigation", { name: "Pricing queues" });
    await expect(queues.getByRole("link", { name: "Priced" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(queues.getByRole("tab")).toHaveCount(0);
    // P0-E8-F1: the empty state sits inside the queue panel (h2), so it is an h3.
    await expect(
      page.getByRole("heading", { level: 3, name: "Nothing has been priced yet." }),
    ).toBeVisible();
    await qaScreenshot(page, "empty-state");
    await expectNoA11yViolations(page);
    await queues.getByRole("link", { name: "Needs attention" }).click();
    await expect(page).toHaveURL(/state=attention/);
    await expect(
      page.getByRole("navigation", { name: "Pricing queues" }).getByRole("link", {
        name: "Needs attention",
      }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("agency scheduler: only routes they can open, each one renders", async ({
    browser,
  }, testInfo) => {
    const page = await signedIn(browser, world.scheduler.email);
    await page.goto(`/app/organisations/${world.agencyId}`);

    const nav = await openWorkspaceNav(page, testInfo);
    const labels = await navLabels(nav);
    expect(labels).toEqual([
      "Overview",
      "Operations",
      "Shifts",
      "Attendance",
      "Timesheets",
      "Workforce",
      "Facilities",
      "Settings",
    ]);
    const hrefs = await nav
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    await closeWorkspaceNav(page, testInfo);

    // No leakage: every listed destination renders for this user (no 404).
    for (const href of hrefs) {
      const response = await page.goto(href);
      expect(response?.status(), href).toBe(200);
    }
    // And a destination that is not listed is genuinely unavailable.
    const payroll = await page.goto(`/app/organisations/${world.agencyId}/payroll`);
    expect(payroll?.status()).toBe(404);

    // Choosing a destination marks it current (detail pages keep it current).
    await page.goto(`/app/organisations/${world.agencyId}`);
    const navAgain = await openWorkspaceNav(page, testInfo);
    await navAgain.getByRole("link", { name: "Shifts" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Shifts" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Workspace navigation" })).toBeHidden();
    const current = await openWorkspaceNav(page, testInfo);
    await expect(current.getByRole("link", { name: "Shifts" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(current.getByRole("link", { name: "Overview" })).not.toHaveAttribute(
      "aria-current",
    );
    await closeWorkspaceNav(page, testInfo);
    await expectNoInventedChrome(page);
    await expectNoA11yViolations(page);
  });

  test("finance: finance navigation, and the switcher moves to another existing workspace", async ({
    browser,
  }, testInfo) => {
    const page = await signedIn(browser, finance.email);
    await page.goto(`/app/organisations/${world.agencyId}`);

    const nav = await openWorkspaceNav(page, testInfo);
    expect(await navLabels(nav)).toEqual([
      "Overview",
      "Timesheets",
      "Facilities",
      "Finance",
      "Settings",
    ]);
    await closeWorkspaceNav(page, testInfo);

    const trigger = page.getByRole("button", { name: /Account and workspace menu/ });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("group", { name: "Current workspace" })).toContainText(
      world.agencyName,
    );
    const switchList = page.getByRole("list", { name: "Switch workspace" });
    await expect(switchList).toBeVisible();
    await expect(page.getByRole("link", { name: "Account" })).toHaveAttribute(
      "href",
      "/app/account",
    );
    await expect(page.getByRole("link", { name: "Security" })).toHaveAttribute(
      "href",
      "/app/security",
    );
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await screenshot(page, testInfo, "switcher-open");
    await expectNoA11yViolations(page);

    // Escape closes the control and returns focus to it.
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();

    await trigger.click();
    await switchList.getByRole("button", { name: new RegExp(world.facilityOrgName) }).click();
    await expect(page).toHaveURL(new RegExp(`/app/organisations/${world.facilityOrgId}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: world.facilityOrgName }),
    ).toBeVisible();
    const facilityNav = await openWorkspaceNav(page, testInfo);
    expect(await navLabels(facilityNav)).toEqual(["Overview", "Staffing requests", "Settings"]);
    await closeWorkspaceNav(page, testInfo);
  });

  test("facility admin: facility subset of the same shell", async ({ browser }, testInfo) => {
    const page = await signedIn(browser, world.facilityAdmin.email);
    await page.goto(`/app/organisations/${world.facilityOrgId}`);

    const nav = await openWorkspaceNav(page, testInfo);
    expect(await navLabels(nav)).toEqual(["Overview", "Staffing requests", "Sign-off", "Settings"]);
    await screenshot(page, testInfo, "facility-admin-overview");
    await closeWorkspaceNav(page, testInfo);
    // Single-workspace user: no switcher choices.
    await page.getByRole("button", { name: /Account and workspace menu/ }).click();
    await expect(page.getByRole("list", { name: "Switch workspace" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await expectNoInventedChrome(page);
    await expectNoA11yViolations(page);
  });

  test("facility supervisor: view-only navigation, no member admin or request creation", async ({
    browser,
  }, testInfo) => {
    const page = await signedIn(browser, supervisor.email);
    await page.goto(`/app/organisations/${world.facilityOrgId}`);

    const nav = await openWorkspaceNav(page, testInfo);
    expect(await navLabels(nav)).toEqual(["Overview", "Staffing requests", "Sign-off", "Settings"]);
    await closeWorkspaceNav(page, testInfo);
    await expect(page.getByRole("button", { name: "Create invitation" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Invitations" })).toHaveCount(0);

    const requests = await openWorkspaceNav(page, testInfo);
    await requests.getByRole("link", { name: "Staffing requests" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Staffing requests" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit request" })).toHaveCount(0);
    await expectNoA11yViolations(page);
  });

  test("worker: self-service pages are not moved into the workspace shell", async ({ browser }) => {
    const page = await signedIn(browser, world.wendy.email);
    for (const path of [
      `/app/organisations/${world.agencyId}`,
      `/app/organisations/${world.agencyId}/my-shifts`,
    ]) {
      await page.goto(path);
      // P0-E8-S6: workers get the P7 worker shell (bottom navigation), never the workspace shell.
      await expect(page.getByRole("navigation", { name: "Worker" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Workspace" })).toHaveCount(0);
      await expect(page.getByRole("complementary", { name: "Workspace sidebar" })).toHaveCount(0);
      if (path.endsWith(world.agencyId)) {
        // Self-service members keep their section links (no sidebar on the personal frame).
        await expect(
          page
            .getByRole("navigation", { name: "Organisation sections" })
            .getByRole("link", { name: "My shifts" }),
        ).toBeVisible();
      }
      await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
    }
  });

  test("finance workspace: one sidebar item, capability-filtered areas, active states (P0-E8-F2.5)", async ({
    browser,
  }, testInfo) => {
    const base = `/app/organisations/${world.agencyId}`;
    const page = await signedIn(browser, finance.email);
    for (const [index, area] of FINANCE_AREAS.entries()) {
      await page.goto(`${base}/${area.toLowerCase()}`);
      await expect(page.getByRole("heading", { level: 1, name: area })).toBeVisible();
      // One shared Finance navigation, locked order; the current area is marked.
      const financeNav = page.getByRole("navigation", { name: "Finance", exact: true });
      expect(await navLabels(financeNav)).toEqual(FINANCE_AREAS);
      await expect(financeNav.getByRole("link", { name: area })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(financeNav.locator('[aria-current="page"]')).toHaveCount(1);
      // The sidebar has a single Finance item, current on every finance route.
      const nav = await openWorkspaceNav(page, testInfo);
      for (const legacy of FINANCE_AREAS) {
        await expect(nav.getByRole("link", { name: legacy, exact: true })).toHaveCount(0);
      }
      await expect(nav.getByRole("link", { name: "Finance" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      if (index === 0) {
        await expect(nav.getByRole("link", { name: "Finance" })).toHaveAttribute(
          "href",
          `${base}/rates`,
        );
      }
      if (isMobile(testInfo)) {
        await page.keyboard.press("Escape");
        await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
      }
      await expectNoPageOverflow(page);
      await expectNoA11yViolations(page);
      await screenshot(page, testInfo, `finance-${area.toLowerCase()}`);
    }
    // Moving between areas through the shared tabs: one Finance shell, the new area current.
    await page.goto(`${base}/rates`);
    const shell = page.getByRole("navigation", { name: "Finance", exact: true });
    await shell.getByRole("link", { name: "Pricing" }).click();
    await expect(page).toHaveURL(`${base}/pricing`);
    await expect(page.getByRole("heading", { level: 1, name: "Pricing" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Finance", exact: true })).toHaveCount(1);
    await expect(shell.getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(shell.locator('[aria-current="page"]')).toHaveCount(1);
    await screenshot(page, testInfo, "finance-tab-after-click");
    // Keyboard: the focused tab shows the full focus ring (not clipped by the scroll row).
    await shell.getByRole("link", { name: "Pricing" }).focus();
    await page.keyboard.press("Tab");
    await expect(shell.getByRole("link", { name: "Payroll" })).toBeFocused();
    await screenshot(page, testInfo, "finance-tab-keyboard-focus");

    // No Finance dashboard route was introduced.
    expect((await page.goto(`${base}/finance`))?.status()).toBe(404);
    await page.context().close();

    // Partial finance access (one area but not another) is proven in the unit tests:
    // no seeded role holds only some finance areas (operations managers hold all four views).

    // No finance capability: no Finance item, and finance routes stay unreachable.
    const scheduler = await signedIn(browser, world.scheduler.email);
    await scheduler.goto(base);
    const schedulerNav = await openWorkspaceNav(scheduler, testInfo);
    expect(await navLabels(schedulerNav)).not.toContain("Finance");
    await closeWorkspaceNav(scheduler, testInfo);
    expect((await scheduler.goto(`${base}/rates`))?.status()).toBe(404);
    await scheduler.context().close();
  });

  test("app entry: workspace chooser with real cards; personal frame navigation (P0-E8-A1.1)", async ({
    browser,
  }, testInfo) => {
    // Fran belongs to the agency (Finance) and the facility (Scheduler).
    const page = await signedIn(browser, finance.email);
    // Signed in, "/" goes to the existing app entry.
    await page.goto("/");
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { level: 1, name: /^Welcome/ })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const list = page.getByRole("list", { name: "Your organisations" });
    const agency = list.getByRole("article", { name: world.agencyName });
    const facility = list.getByRole("article", { name: world.facilityOrgName });
    await expect(agency).toContainText("Agency");
    await expect(agency).toContainText("Finance");
    await expect(facility).toContainText("Facility");
    await expect(facility).toContainText("Scheduler");
    await expect(page.getByRole("main")).not.toContainText(/role\(s\)/);
    await expect(
      list.getByRole("button", { name: new RegExp(`^Open workspace ${world.agencyName}$`) }),
    ).toBeVisible();
    expect(await page.getByText("Last used").count()).toBeLessThanOrEqual(1);
    await expect(page.getByRole("region", { name: "Create a new agency" })).toBeVisible();
    // P0-E8-A1.3 / A1.4: from lg the gateway puts workspaces (primary, ~64%) beside the create
    // panel with a 24 px gap, tops aligned; below lg it stacks organisations above Create.
    const orgsBox = await page.getByRole("region", { name: "Your organisations" }).boundingBox();
    const createBox = await page.getByRole("region", { name: "Create a new agency" }).boundingBox();
    const agencyBox = await agency.boundingBox();
    const facilityBox = await facility.boundingBox();
    if (!orgsBox || !createBox || !agencyBox || !facilityBox) throw new Error("gateway missing");
    if (isMobile(testInfo)) {
      expect(createBox.y).toBeGreaterThanOrEqual(orgsBox.y + orgsBox.height);
    } else {
      const gap = createBox.x - (orgsBox.x + orgsBox.width);
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(25);
      expect(orgsBox.width).toBeGreaterThan(createBox.width * 1.4);
      const share = orgsBox.width / (orgsBox.width + createBox.width);
      expect(share).toBeGreaterThan(0.6);
      expect(share).toBeLessThan(0.68);
      expect(Math.abs(createBox.y - orgsBox.y)).toBeLessThan(8);
      // The two-organisation fixture stays 2-up in the left column.
      expect(Math.abs(agencyBox.y - facilityBox.y)).toBeLessThan(2);
      const [left, right] =
        agencyBox.x < facilityBox.x ? [agencyBox, facilityBox] : [facilityBox, agencyBox];
      expect(right.x).toBeGreaterThan(left.x + left.width);
    }
    await expectNoPageOverflow(page);

    // Personal frame: compact account navigation with the current destination marked.
    const nav = page.getByRole("navigation", { name: "Account" });
    await expect(nav.getByRole("link", { name: "Organisations" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Workspace" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Worker" })).toHaveCount(0);
    await expectNoA11yViolations(page);
    await screenshot(page, testInfo, "a11-app-chooser");
    if (isMobile(testInfo)) {
      for (const width of [375, 412]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoPageOverflow(page);
      }
    }
    for (const [path, label, panel] of [
      ["/app/account", "Account", "Profile details"],
      ["/app/security", "Security", "Authenticator app"],
    ] as const) {
      await page.goto(path);
      await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      // P0-E8-A1.3: content sits in a locked panel inside a purposeful column (≤ 760 px).
      const region = page.getByRole("region", { name: panel });
      await expect(region).toBeVisible();
      expect((await region.boundingBox())?.width ?? 0).toBeLessThanOrEqual(761);
      await screenshot(page, testInfo, `a13-${label.toLowerCase()}`);
      await expectNoPageOverflow(page);
      await expectNoA11yViolations(page);
    }
    await page.goto("/app/account");
    const profile = page.getByRole("region", { name: "Profile details" });
    await expect(profile.getByLabel("Full name")).toBeVisible();
    await expect(profile.getByRole("button", { name: "Save" })).toBeVisible();
    // Opening a workspace still goes through the existing selection action.
    await page.goto("/app");
    await list
      .getByRole("button", { name: new RegExp(`^Open workspace ${world.agencyName}$`) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/app/organisations/${world.agencyId}$`));
    await page.context().close();

    // P0-E8-A1.4: a single workspace (Sue belongs only to the facility) gets one comfortable
    // card on desktop rather than half the column; below lg it keeps the stacked full width.
    const single = await signedIn(browser, supervisor.email);
    await single.goto("/app");
    const singleList = single.getByRole("list", { name: "Your organisations" });
    await expect(singleList.getByRole("article")).toHaveCount(1);
    const card = await singleList
      .getByRole("article", { name: world.facilityOrgName })
      .boundingBox();
    const column = await single.getByRole("region", { name: "Your organisations" }).boundingBox();
    const create = await single.getByRole("region", { name: "Create a new agency" }).boundingBox();
    if (!card || !column || !create) throw new Error("single-organisation gateway missing");
    if (isMobile(testInfo)) {
      expect(create.y).toBeGreaterThanOrEqual(column.y + column.height);
      expect(Math.abs(card.width - column.width)).toBeLessThan(2);
    } else {
      expect(card.width).toBeGreaterThan((column.width - 16) / 2 + 60);
      expect(card.width).toBeLessThanOrEqual(561);
      expect(create.x).toBeGreaterThanOrEqual(column.x + column.width);
      expect(Math.abs(create.y - column.y)).toBeLessThan(8);
    }
    await expectNoPageOverflow(single);
    await screenshot(single, testInfo, "a14-single-organisation");
    await single.context().close();
  });

  test("narrow viewport: the sidebar becomes an accessible overlay", async ({
    browser,
  }, testInfo) => {
    const page = await signedIn(browser, world.scheduler.email);
    await page.goto(`/app/organisations/${world.agencyId}`);
    const trigger = page.getByRole("button", { name: "Open navigation" });

    if (!isMobile(testInfo)) {
      // Desktop: persistent sidebar, no trigger.
      await expect(page.getByRole("navigation", { name: "Workspace" })).toBeVisible();
      await expect(trigger).toBeHidden();
      return;
    }

    await expect(page.getByRole("navigation", { name: "Workspace" })).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Workspace navigation" });
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    // Modal: focus moves inside, the background is inert.
    await expect(dialog.getByRole("button", { name: "Close navigation" })).toBeFocused();
    expect(await page.locator("dialog[open]").evaluate((node) => node.matches(":modal"))).toBe(
      true,
    );
    await screenshot(page, testInfo, "narrow-nav-open");
    await expectNoA11yViolations(page);

    // Focus stays trapped in the overlay.
    for (let step = 0; step < 12; step += 1) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(
      true,
    );

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await dialog.getByRole("button", { name: "Close navigation" }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
