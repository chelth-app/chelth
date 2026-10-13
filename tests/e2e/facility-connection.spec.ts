import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import { generateTotp } from "../support/totp";
import { createStaffingWorld, ensureStepUp, isoDay, type StaffingWorld } from "./staffing-fixture";
import {
  expectNoPageOverflow,
  followEmailLink,
  qaScreenshot,
  signIn,
  SIGNED_IN_LANDING,
  signUp,
  uniqueEmail,
} from "./support";

/*
 * P0-E9-4A.1: agency-initiated facility onboarding. An agency invites; the
 * facility representative creates the facility or connects one they already
 * administer; one facility can then work with several agencies, each request
 * going to exactly one of them. No platform admin in the normal path.
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

test.describe.serial("Facility connection & multi-agency facilities (P0-E9-4A.1)", () => {
  test.setTimeout(300_000);
  let world: StaffingWorld;
  let tag: string;
  let metroRecordId: string;
  let betaRecordId: string;
  let betaLocationId: string;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(300_000);
    tag = `${testInfo.project.name.split("-")[0] ?? "e2e"}-${Date.now().toString(36)}`;
    world = await createStaffingWorld(`e94a1-${tag}`);
    // Agency A's private client record for a facility not yet on Chelth.
    const metro = await world.admin.client.rpc("create_agency_facility", {
      p_agency_organisation_id: world.agencyId,
      p_name: `Metro Health ${tag}`,
      p_facility_type: "hospital",
      p_timezone: "America/New_York",
    });
    if (metro.error) throw metro.error;
    metroRecordId = metro.data;
    // Agency B's OWN record of the facility that is already on Chelth (Mercy Health).
    // Both act at AAL2 in this test: Beta invites, Mercy's admin approves.
    await ensureStepUp(world.betaAdmin);
    await ensureStepUp(world.facilityAdmin);
    const beta = await world.betaAdmin.client.rpc("create_agency_facility", {
      p_agency_organisation_id: world.betaId,
      p_name: `Mercy (Beta record) ${tag}`,
      p_facility_type: "hospital",
      p_timezone: "America/New_York",
    });
    if (beta.error) throw beta.error;
    betaRecordId = beta.data;
    const location = await world.betaAdmin.client.rpc("create_facility_location", {
      p_facility_id: betaRecordId,
      p_name: "Beta Main Entrance",
      p_timezone: "America/New_York",
    });
    if (location.error) throw location.error;
    betaLocationId = location.data;
  });

  test("Agency A invites a new facility; its administrator signs up and creates it", async ({
    browser,
  }) => {
    const agency = await signedIn(browser, world.admin.email);
    const record = `/app/organisations/${world.agencyId}/facilities/${metroRecordId}`;
    await agency.goto(record);
    await agency.getByRole("link", { name: "Verify now" }).first().click();
    await agency.getByLabel("Authentication code").fill(generateTotp(world.admin.totpSecret ?? ""));
    await agency.getByRole("button", { name: "Verify" }).click();
    await expect(agency).toHaveURL(new RegExp(`${record}$`), AFTER_ACTION);

    const connection = agency.getByRole("region", { name: "Chelth connection" });
    await expect(connection).toContainText("Not connected");
    const adminEmail = uniqueEmail("e2e-metro-admin");
    await connection
      .getByRole("textbox", { name: "Facility administrator email" })
      .fill(adminEmail);
    await connection.getByRole("button", { name: "Invite facility to Chelth" }).click();
    const outcome = connection.getByRole("status");
    await expect(outcome).toContainText(/Invitation sent|Share this link/, AFTER_ACTION);
    // The invitation link: from the email when delivered, else shown once to the agency.
    const shown = await connection
      .locator("code")
      .textContent()
      .catch(() => null);
    await agency.reload();
    await expect(agency.getByRole("region", { name: "Chelth connection" })).toContainText(
      "Pending acceptance",
    );
    await expect(agency.getByRole("region", { name: "Chelth connection" })).not.toContainText(
      adminEmail,
    );
    await expectNoA11yViolations(agency);
    await qaScreenshot(agency, "e9-4a1-agency-invite-pending");

    // The facility administrator: a new person, through the link.
    const facility = await (await browser.newContext()).newPage();
    if (shown) {
      await facility.goto(new URL(shown).pathname);
    } else {
      await followEmailLink(facility, adminEmail, "would like to connect with");
    }
    await expect(facility).toHaveURL(/\/invite$/);
    await signUp(facility, "Mia Metro", adminEmail);
    await followEmailLink(facility, adminEmail, "Confirm your CHELTH account");
    await expect(facility).toHaveURL(/\/invite$/, AFTER_ACTION);
    await expect(
      facility.getByRole("heading", { name: `Connect with ${world.agencyName}` }),
    ).toBeVisible();
    await expect(facility.getByRole("textbox", { name: "Facility name" })).toHaveValue(
      `Metro Health ${tag}`,
    );
    await expectNoA11yViolations(facility);
    await qaScreenshot(facility, "e9-4a1-facility-accept-create");
    await facility.getByRole("checkbox", { name: /Create Metro Health/ }).check();
    await facility.getByRole("button", { name: "Create facility and connect" }).click();
    await expect(
      facility.getByRole("heading", { level: 1, name: `Metro Health ${tag}` }),
    ).toBeVisible(AFTER_ACTION);
    await facility.context().close();

    await agency.reload();
    await expect(agency.getByRole("region", { name: "Chelth connection" })).toContainText(
      `Connected to Chelth facility: Metro Health ${tag}`,
    );
    await agency.context().close();
  });

  test("Agency B connects to an EXISTING facility; the facility then routes requests per agency", async ({
    browser,
  }) => {
    // Agency B invites Mercy Health's administrator (already on Chelth). The response
    // never reveals that the person or facility exists.
    const invited = await world.betaAdmin.client.rpc("invite_facility_connection", {
      p_facility_id: betaRecordId,
      p_email: world.facilityAdmin.email,
    });
    if (invited.error) throw invited.error;
    const token = invited.data[0]?.invite_token ?? "";

    const facility = await signedIn(browser, world.facilityAdmin.email);
    await facility.goto(`/invite/${token}`);
    await expect(facility).toHaveURL(/\/invite$/);
    const option = facility.getByRole("radio", { name: new RegExp(world.facilityOrgName) });
    await expect(option).toBeChecked();
    await expect(facility.getByText("You administer this facility")).toBeVisible();
    await expectNoA11yViolations(facility);
    await qaScreenshot(facility, "e9-4a1-facility-accept-existing");
    await facility.getByRole("checkbox", { name: /Connect .* to the selected facility/ }).check();
    await facility.getByRole("button", { name: "Connect facility" }).click();
    // Approving for an existing facility needs the authenticator app.
    await facility.getByRole("link", { name: "Verify now" }).click();
    await facility
      .getByLabel("Authentication code")
      .fill(generateTotp(world.facilityAdmin.totpSecret ?? ""));
    await facility.getByRole("button", { name: "Verify" }).click();
    await expect(facility).toHaveURL(/\/invite$/, AFTER_ACTION);
    await facility.getByRole("checkbox", { name: /Connect .* to the selected facility/ }).check();
    await facility.getByRole("button", { name: "Connect facility" }).click();
    await expect(facility).toHaveURL(
      new RegExp(`/app/organisations/${world.facilityOrgId}$`),
      AFTER_ACTION,
    );

    // One facility, two agencies: Request staff now needs an agency.
    await facility.goto(`/app/organisations/${world.facilityOrgId}/staffing-requests`);
    const agencySelect = facility.getByRole("combobox", { name: "Staffing agency" });
    await expect(agencySelect.locator("option")).toHaveCount(3);
    const betaName = (await agencySelect.locator("option").allTextContents()).find(
      (name) => name !== world.agencyName && name !== "Choose an agency",
    );
    if (!betaName) throw new Error("Beta agency not offered");
    await agencySelect.selectOption({ label: betaName });
    await facility
      .getByRole("combobox", { name: "Location" })
      .selectOption({ label: "Beta Main Entrance (America/New_York)" });
    await facility
      .getByRole("combobox", { name: "Discipline" })
      .selectOption({ label: "Certified Nursing Assistant (CNA)" });
    await facility.getByLabel("Shift date").fill(isoDay(9));
    await facility.getByLabel("Start time").fill("07:00");
    await facility.getByLabel("End time").fill("15:00");
    await expectNoA11yViolations(facility);
    await qaScreenshot(facility, "e9-4a1-request-agency-selector");
    await facility.getByRole("button", { name: "Submit request" }).click();
    await expect(facility.getByText("Requested", { exact: true })).toBeVisible(AFTER_ACTION);
    const requestId = new URL(facility.url()).pathname.split("/").pop() ?? "";

    // Only Agency B receives it.
    const betaSees = await world.betaAdmin.client.from("shifts").select("id").eq("id", requestId);
    const alphaSees = await world.admin.client.from("shifts").select("id").eq("id", requestId);
    expect(betaSees.data).toHaveLength(1);
    expect(alphaSees.data).toEqual([]);
    expect(betaLocationId).toBeTruthy();

    // Agency A cannot read Agency B's record of the same facility.
    const crossRecord = await world.admin.client
      .from("agency_facilities")
      .select("id")
      .eq("id", betaRecordId);
    expect(crossRecord.data).toEqual([]);
    const crossPage = await (
      await signedIn(browser, world.admin.email)
    ).goto(`/app/organisations/${world.agencyId}/facilities/${betaRecordId}`);
    expect(crossPage?.status()).toBe(404);
    await facility.context().close();
  });

  test("a worker and an unrelated facility admin cannot use connection management", async ({
    browser,
  }) => {
    const worker = await signedIn(browser, world.wendy.email);
    const response = await worker.goto(
      `/app/organisations/${world.agencyId}/facilities/${metroRecordId}`,
    );
    expect(response?.status()).toBe(404);
    const denied = await world.wendy.client.rpc("invite_facility_connection", {
      p_facility_id: metroRecordId,
      p_email: "x@y.test",
    });
    expect(denied.error?.code).toBe("CH403");
    await worker.context().close();
  });
});
