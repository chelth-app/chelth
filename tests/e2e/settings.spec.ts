import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import { generateTotp } from "../support/totp";
import {
  agencyMember,
  createStaffingWorld,
  passwordOnlyClient,
  type StaffingWorld,
} from "./staffing-fixture";
import { uniqueEmail } from "../support/mailpit";
import { expectNoPageOverflow, qaScreenshot, signIn, SIGNED_IN_LANDING } from "./support";

/*
 * Settings (P0-E8-S9H): one consolidated route over the administration Chelth
 * already has. Only supported sections are listed; every visible save works;
 * privileged changes keep the authenticator step-up; sections follow the
 * caller's capabilities, never their role name.
 */
const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const AFTER_ACTION = { timeout: 20_000 };
const ADMIN_SECTIONS = [
  "Organization",
  "Team & Permissions",
  "Attendance & Geofencing",
  "Timesheets & Payroll",
  "Rates & Billing",
  "Credentials & Compliance",
  "Security",
];

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

async function sectionLabels(page: Page): Promise<string[]> {
  return page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link")
    .allInnerTexts()
    .then((labels) => labels.map((label) => label.trim()));
}

test.describe.serial("settings", () => {
  test.setTimeout(240_000);
  let world: StaffingWorld;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    world = await createStaffingWorld(`set-${testInfo.project.name.split("-")[0] ?? "e2e"}`, [
      { key: "ana", name: "Ana Ortiz", blsExpiryDays: 400 },
    ]);
  });

  test("agency admin: consolidated Settings with real sections, read-only identity, working saves", async ({
    browser,
  }, testInfo) => {
    const desktop = !testInfo.project.name.startsWith("mobile");
    const page = await signedIn(browser, world.admin.email);
    const base = `/app/organisations/${world.agencyId}/settings`;
    if (desktop) await page.setViewportSize({ width: 1512, height: 996 });

    // The sidebar entry is real and opens the landing section.
    await page.goto(`/app/organisations/${world.agencyId}`);
    if (desktop) {
      await page
        .getByRole("navigation", { name: "Workspace" })
        .getByRole("link", { name: "Settings", exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`${base}$`));
    } else {
      await page.goto(base);
    }
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    expect(await sectionLabels(page)).toEqual(ADMIN_SECTIONS);
    await expect(
      page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", {
        name: "Organization",
      }),
    ).toHaveAttribute("aria-current", "page");
    // Unsupported reference sections are not faked.
    for (const absent of ["Notifications", "Integrations", "Shifts & Scheduling", "Workspace"]) {
      await expect(
        page
          .getByRole("navigation", { name: "Settings sections" })
          .getByRole("link", { name: absent, exact: true }),
      ).toHaveCount(0);
    }
    const details = page.getByRole("region", { name: "Workspace Details" });
    await expect(details).toContainText(world.agencyName);
    await expect(details).toContainText(world.agencyId);
    // Read-only identity: no form, no Save button.
    await expect(page.getByRole("main").getByRole("button", { name: /save/i })).toHaveCount(0);
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "stqa-settings");

    // Team & Permissions waits for step-up, then shows the existing administration.
    await page.goto(`${base}/team`);
    await expect(page.getByRole("region", { name: "Members table" })).toBeVisible();
    await page.getByRole("link", { name: "Verify now" }).click();
    await page.getByLabel("Authentication code").fill(generateTotp(world.admin.totpSecret ?? ""));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/team$`), AFTER_ACTION);
    await expect(page.getByRole("button", { name: "Create invitation" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Role Permissions" })).toContainText(
      "permissions",
    );
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "stqa-settings-team");

    // Attendance & Geofencing: the existing rules form saves for real.
    await page.goto(`${base}/attendance`);
    await page.getByRole("button", { name: "Save attendance rules" }).click();
    await expect(page.getByText("Attendance rules saved.")).toBeVisible(AFTER_ACTION);
    await expect(
      page.getByRole("link", { name: "Manage location checks on Facilities" }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "stqa-settings-attendance");

    // Timesheets & Payroll: week start, pay period / references, finance controls.
    await page.goto(`${base}/payroll`);
    await expect(page.getByRole("button", { name: "Save week start" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save payroll settings" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Finance Controls" })).toContainText(
      "never executes payments",
    );
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "stqa-settings-payroll");

    // Security: real session state and the audit log; no invented session controls.
    await page.goto(`${base}/security`);
    const account = page.getByRole("region", { name: "Your Account Security" });
    await expect(account).toContainText("Verified with authenticator");
    await expect(account).toContainText("Set up");
    await expect(page.getByRole("region", { name: "Audit Log" })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText(/session timeout|revoke session/i);
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "stqa-settings-security");

    // The moved panels are gone from their old homes.
    await page.goto(`/app/organisations/${world.agencyId}/attendance`);
    await expect(page.getByRole("button", { name: "Save attendance rules" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Settings", exact: true }).first()).toBeVisible();

    if (desktop) {
      await page.goto(base);
      for (const [width, height] of [
        [1280, 900],
        [1440, 900],
        [1920, 1080],
        [768, 1024],
        [412, 915],
        [375, 812],
      ] as const) {
        await page.setViewportSize({ width, height });
        await expectNoPageOverflow(page);
        await qaScreenshot(page, "stqa-settings");
      }
    }
    await page.context().close();
  });

  test("Credentials & Compliance and the account menu at four widths (P0-E8-S9H1)", async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name.startsWith("mobile"), "explicit widths below");
    const page = await signedIn(browser, world.admin.email);
    const compliance = `/app/organisations/${world.agencyId}/settings/compliance`;
    for (const [width, height] of [
      [1440, 900],
      [1920, 1080],
      [768, 1024],
      [412, 915],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(compliance);
      await expect(
        page.getByRole("region", { name: "Credential Requirement Rules" }),
      ).toContainText("Basic Life Support");
      await expectNoA11yViolations(page);
      await qaScreenshot(page, "stqa-settings-compliance");

      const trigger = page.getByRole("button", { name: /Account and workspace menu/ });
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("group", { name: "Current workspace" })).toContainText(
        world.agencyName,
      );
      await expectNoA11yViolations(page);
      await qaScreenshot(page, "stqa-account-menu");
      await page.keyboard.press("Escape");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(trigger).toBeFocused();
    }
    await page.context().close();
  });

  test("canonical Settings lock: selected section visible, navigation-only related areas (P0-E8)", async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name.startsWith("mobile"), "explicit widths below");
    const page = await signedIn(browser, world.admin.email);
    const shots = process.env.QA_SCREENSHOTS_DIR;
    await page.goto(`/app/organisations/${world.agencyId}/settings/compliance`);
    const nav = page.getByRole("navigation", { name: "Settings sections" });
    const current = nav.getByRole("link", { name: "Credentials & Compliance" });
    const related = page.getByRole("region", { name: "Related Compliance Areas" });

    for (const [width, height] of [
      [1440, 900],
      [768, 1024],
      [412, 915],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.reload();
      await expect(current).toHaveAttribute("aria-current", "page");
      // The current section is inside the nav's visible area, even where the nav scrolls.
      const [navBox, itemBox] = await Promise.all([nav.boundingBox(), current.boundingBox()]);
      if (!navBox || !itemBox) throw new Error("Settings navigation is not rendered");
      expect(itemBox.x).toBeGreaterThanOrEqual(navBox.x - 1);
      expect(itemBox.x + itemBox.width).toBeLessThanOrEqual(navBox.x + navBox.width + 1);

      // Related areas: navigation only — links, no controls, no fake inputs.
      await expect(related.getByRole("link")).not.toHaveCount(0);
      await expect(related.locator("button, input, select, textarea")).toHaveCount(0);
      // Every Settings action is a 44 px target.
      for (const height of await page
        .getByRole("main")
        .locator("section a")
        .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height))) {
        expect(height).toBeGreaterThanOrEqual(44);
      }
      await expectNoPageOverflow(page);

      if (width < 1024) {
        // P0-E8-A1.3: the mobile row keeps scrolling but hides scrollbar chrome.
        const row = await nav.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            scrollbarWidth: style.scrollbarWidth,
            scrollable: element.scrollWidth > element.clientWidth,
          };
        });
        expect(row).toMatchObject({
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "none",
        });
        if (row.scrollable) {
          expect(
            await nav.evaluate((element) => {
              element.scrollLeft = 0;
              element.scrollLeft = 120;
              return element.scrollLeft;
            }),
          ).toBeGreaterThan(0);
        }
        await expectNoA11yViolations(page);
      }

      if (width >= 1024) {
        // Desktop: the sticky section nav stays clear of the sticky top bar when scrolled.
        await related.scrollIntoViewIfNeeded();
        const [header, stuck] = await Promise.all([
          page.locator("header").first().boundingBox(),
          nav.boundingBox(),
        ]);
        if (!header || !stuck) throw new Error("Shell header or Settings navigation missing");
        expect(stuck.y).toBeGreaterThanOrEqual(header.y + header.height);
      }

      if (shots) {
        await page.screenshot({ path: `${shots}/${width}px-settings-lock-compliance.png` });
        await page.screenshot({
          path: `${shots}/${width}px-settings-lock-compliance-full.png`,
          fullPage: true,
        });
        await related.screenshot({ path: `${shots}/${width}px-settings-lock-related.png` });
        await nav.screenshot({ path: `${shots}/${width}px-settings-lock-subnav.png` });
      }
    }
    await page.context().close();
  });

  test("Team & Permissions: verify to manage at AAL1, existing controls at AAL2, AAL1 rejected server-side", async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name.startsWith("mobile"), "one pass is enough; desktop only");
    const team = `/app/organisations/${world.agencyId}/settings/team`;
    const verifyHref = `/app/security/verify?next=${encodeURIComponent(team)}`;
    // A dedicated member to act on, and a pending invitation (arranged by the AAL2 API admin).
    const target = await agencyMember(
      world,
      "e2e-team-target",
      "Tara Target",
      "agency.credentialing_officer",
    );
    const pendingEmail = uniqueEmail("e2e-team-pending");
    const { data: issued, error: inviteError } = await world.admin.client.rpc(
      "create_organisation_invite",
      {
        p_organisation_id: world.agencyId,
        p_email: pendingEmail,
        p_role_key: "agency.scheduler",
      },
    );
    if (inviteError) throw inviteError;
    const inviteId = issued?.[0]?.invite_id ?? "";
    const membershipOf = async (profileId: string) => {
      const { data, error } = await world.admin.client
        .from("organisation_memberships")
        .select("id")
        .eq("organisation_id", world.agencyId)
        .eq("profile_id", profileId)
        .single();
      if (error) throw error;
      return data.id;
    };
    const targetMembership = await membershipOf(target.userId);
    const adminMembership = await membershipOf(world.admin.userId);

    // Server side: a password-only (AAL1) session holding the capabilities is refused (CH402).
    const aal1 = await passwordOnlyClient(world.admin.email);
    for (const attempt of [
      aal1.rpc("set_membership_status", {
        p_membership_id: targetMembership,
        p_status: "suspended",
      }),
      aal1.rpc("assign_membership_role", {
        p_membership_id: targetMembership,
        p_role_key: "agency.scheduler",
      }),
      aal1.rpc("revoke_membership_role", {
        p_membership_id: targetMembership,
        p_role_key: "agency.credentialing_officer",
      }),
      aal1.rpc("create_organisation_invite", {
        p_organisation_id: world.agencyId,
        p_email: uniqueEmail("e2e-team-aal1"),
        p_role_key: "agency.scheduler",
      }),
      aal1.rpc("resend_organisation_invite", { p_invite_id: inviteId }),
      aal1.rpc("revoke_organisation_invite", { p_invite_id: inviteId }),
    ]) {
      expect((await attempt).error?.code).toBe("CH402");
    }
    // Even at AAL2, nobody changes their own roles (CH403).
    const self = await world.admin.client.rpc("assign_membership_role", {
      p_membership_id: adminMembership,
      p_role_key: "agency.scheduler",
    });
    expect(self.error?.code).toBe("CH403");

    // A member without the capabilities: plain "—", no verification prompt, no Invitations.
    const scheduler = await signedIn(browser, world.scheduler.email);
    await scheduler.goto(team);
    await expect(scheduler.getByRole("region", { name: "Members table" })).toBeVisible();
    await expect(scheduler.getByRole("link", { name: /Verify to manage/ })).toHaveCount(0);
    await expect(scheduler.getByRole("region", { name: "Invitations" })).toHaveCount(0);
    await expect(
      scheduler
        .getByRole("row")
        .filter({ has: scheduler.getByRole("rowheader", { name: "Tara Target" }) })
        .getByRole("cell")
        .last(),
    ).toHaveText("—");
    await scheduler.context().close();

    // Agency Admin at AAL1.
    const page = await signedIn(browser, world.admin.email);
    await page.setViewportSize({ width: 1512, height: 996 });
    await page.goto(team);
    const rowOf = (name: string | RegExp) =>
      page.getByRole("row").filter({ has: page.getByRole("rowheader", { name }) });
    const verifyTarget = rowOf("Tara Target").getByRole("link", {
      name: "Verify to manage Tara Target",
    });
    await expect(verifyTarget).toHaveAttribute("href", verifyHref);
    await expect(rowOf(/Ada Admin/).getByRole("link")).toHaveCount(0);
    await expect(
      rowOf(/Ada Admin/)
        .getByRole("cell")
        .last(),
    ).toHaveText("—");
    await expect(
      page.getByRole("button", { name: /^(Assign role to|Suspend|Remove)/ }),
    ).toHaveCount(0);
    const invitations = page.getByRole("region", { name: "Invitations" });
    await expect(invitations).toContainText("Verification required");
    await expect(
      invitations.getByRole("link", { name: "Verify to manage invitations" }),
    ).toHaveAttribute("href", verifyHref);
    await expect(invitations).not.toContainText(pendingEmail);
    await expect(page.getByRole("button", { name: "Create invitation" })).toHaveCount(0);
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "team-aal1");

    // The existing step-up flow returns to Team & Permissions.
    await verifyTarget.click();
    await page.getByLabel("Authentication code").fill(generateTotp(world.admin.totpSecret ?? ""));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(new RegExp(`${team}$`), AFTER_ACTION);

    // AAL2: the existing member and invitation controls; still nothing on the own row.
    await expect(page.getByRole("link", { name: /Verify to manage/ })).toHaveCount(0);
    await expect(
      rowOf("Tara Target").getByRole("button", { name: "Assign role to Tara Target" }),
    ).toBeVisible();
    await expect(
      rowOf(/Ada Admin/)
        .getByRole("cell")
        .last(),
    ).toHaveText("—");
    await expect(page.getByRole("button", { name: "Create invitation" })).toBeVisible();
    await expect(invitations.getByRole("listitem").filter({ hasText: pendingEmail })).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Revoke invitation to ${pendingEmail}` }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
    await qaScreenshot(page, "team-aal2");

    // A change refreshes the page in place (no reload): suspend, then reinstate.
    await page.getByRole("button", { name: "Suspend Tara Target" }).click();
    await expect(page.getByRole("button", { name: "Reinstate Tara Target" })).toBeVisible(
      AFTER_ACTION,
    );
    await page.getByRole("button", { name: "Reinstate Tara Target" }).click();
    await expect(page.getByRole("button", { name: "Suspend Tara Target" })).toBeVisible(
      AFTER_ACTION,
    );
    await page.context().close();
  });

  test("scheduler: Settings follows capabilities; privileged sections are not reachable", async ({
    browser,
  }) => {
    const page = await signedIn(browser, world.scheduler.email);
    const base = `/app/organisations/${world.agencyId}/settings`;
    await page.goto(base);
    const labels = await sectionLabels(page);
    expect(labels[0]).toBe("Organization");
    expect(labels).toContain("Security");
    for (const hidden of ["Timesheets & Payroll", "Rates & Billing"]) {
      expect(labels).not.toContain(hidden);
    }
    for (const path of ["payroll", "rates"]) {
      expect((await page.goto(`${base}/${path}`))?.status()).toBe(404);
    }
    await page.context().close();
  });

  test("other tenants cannot open this workspace's Settings", async ({ browser }) => {
    const facility = await signedIn(browser, world.facilityAdmin.email);
    for (const path of ["", "/team", "/security"]) {
      expect(
        (await facility.goto(`/app/organisations/${world.agencyId}/settings${path}`))?.status(),
      ).toBe(404);
    }
    // The facility's own Settings shows only facility-applicable sections.
    await facility.goto(`/app/organisations/${world.facilityOrgId}/settings`);
    const labels = await sectionLabels(facility);
    for (const agencyOnly of [
      "Attendance & Geofencing",
      "Timesheets & Payroll",
      "Rates & Billing",
      "Credentials & Compliance",
    ]) {
      expect(labels).not.toContain(agencyOnly);
    }
    await facility.context().close();
  });
});
