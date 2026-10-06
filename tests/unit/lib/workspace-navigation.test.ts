import { describe, expect, it } from "vitest";

import { isNavItemActive } from "@/components/layout/workspace-navigation-model";
import {
  buildWorkspaceNavigation,
  isWorkspaceStaff,
} from "@/features/organisations/workspace-navigation";
import {
  CAPABILITIES,
  capabilityState,
  type CapabilityGrant,
  type CapabilityKey,
  type OrganisationType,
} from "@/lib/authz";

/*
 * Role → capability sets as seeded by the database (authz.role_capabilities).
 * The builder never sees roles: these fixtures only produce realistic grants.
 */
const ALL = Object.values(CAPABILITIES);
const ROLE_GRANTS: Record<string, CapabilityKey[]> = {
  "agency.admin": ALL,
  "agency.scheduler": [
    "organisation.view",
    "assignment.manage",
    "assignment.view",
    "attendance.view",
    "compliance.view",
    "facility.view",
    "membership.view",
    "relationship.view",
    "shift.create",
    "shift.manage",
    "shift.view",
    "timesheet.view",
    "worker.view",
  ],
  "agency.finance": [
    "organisation.view",
    "facility.view",
    "invoice.view",
    "invoice.prepare",
    "invoice.approve",
    "invoice.export",
    "membership.view",
    "payroll.view",
    "payroll.prepare",
    "payroll.approve",
    "payroll.export",
    "pricing.view",
    "pricing.run",
    "rates.view",
    "rates.manage",
    "relationship.view",
    "timesheet.view",
  ],
  "agency.healthcare_worker": ["organisation.view"],
  "facility.admin": [
    "organisation.view",
    "attendance.view",
    "audit.view",
    "credential.view",
    "membership.invite",
    "membership.manage",
    "membership.view",
    "organisation.manage",
    "relationship.view",
    "role.assign",
    "shift.request",
    "shift.view",
    "timesheet.facility_signoff",
  ],
  "facility.scheduler": [
    "organisation.view",
    "attendance.view",
    "credential.view",
    "membership.view",
    "relationship.view",
    "shift.request",
    "shift.view",
  ],
  "facility.supervisor": [
    "organisation.view",
    "attendance.view",
    "membership.view",
    "shift.view",
    "timesheet.facility_signoff",
  ],
};

const ORG = "11111111-1111-4111-8111-111111111111";

function navFor(
  role: string,
  type: OrganisationType,
  { hasWorkerRecord = false, stepUp = false } = {},
) {
  const grants: CapabilityGrant[] = (ROLE_GRANTS[role] ?? []).map((capabilityKey) => ({
    capabilityKey,
    isPrivileged: stepUp,
    isSatisfied: !stepUp,
  }));
  const groups = buildWorkspaceNavigation({
    organisationId: ORG,
    organisationType: type,
    can: (capability) => capabilityState(grants, capability),
    hasWorkerRecord,
  });
  const items = groups.flatMap((group) => group.items);
  return { groups, labels: items.map((item) => item.label), items };
}

const FORBIDDEN_LABELS = [
  "Reports",
  "Notifications",
  "Credentials",
  "Search",
  "My shifts",
  "My credentials",
];

describe("buildWorkspaceNavigation", () => {
  it("gives an agency admin the full agency navigation, in the approved order", () => {
    expect(navFor("agency.admin", "agency").labels).toEqual([
      "Overview",
      "Operations",
      "Shifts",
      "Attendance",
      "Timesheets",
      "Workforce",
      "Facilities",
      "Compliance",
      "Rates",
      "Pricing",
      "Payroll",
      "Invoices",
      "Settings",
    ]);
  });

  it("limits an agency scheduler to the routes their capabilities open", () => {
    expect(navFor("agency.scheduler", "agency").labels).toEqual([
      "Overview",
      "Operations",
      "Shifts",
      "Attendance",
      "Timesheets",
      "Workforce",
      "Facilities",
      "Settings",
    ]);
  });

  it("gives agency finance the finance routes and no operational ones", () => {
    expect(navFor("agency.finance", "agency").labels).toEqual([
      "Overview",
      "Timesheets",
      "Facilities",
      "Rates",
      "Pricing",
      "Payroll",
      "Invoices",
      "Settings",
    ]);
  });

  it("gives a facility admin requests and timesheet sign-off only", () => {
    expect(navFor("facility.admin", "facility").labels).toEqual([
      "Overview",
      "Staffing requests",
      "Timesheet sign-off",
      "Settings",
    ]);
  });

  it("gives a facility scheduler requests without sign-off", () => {
    expect(navFor("facility.scheduler", "facility").labels).toEqual([
      "Overview",
      "Staffing requests",
      "Settings",
    ]);
  });

  it("gives a facility supervisor view routes only", () => {
    expect(navFor("facility.supervisor", "facility").labels).toEqual([
      "Overview",
      "Staffing requests",
      "Timesheet sign-off",
      "Settings",
    ]);
  });

  it("never lists agency routes in a facility workspace, even with every capability", () => {
    const { labels } = navFor("agency.admin", "facility");
    expect(labels).toEqual(["Overview", "Staffing requests", "Timesheet sign-off", "Settings"]);
  });

  it("lists capabilities pending MFA step-up (the page renders a step-up notice)", () => {
    expect(navFor("agency.finance", "agency", { stepUp: true }).labels).toContain("Payroll");
  });

  it("lists Timesheets for a staff member who is also a worker (own timesheets)", () => {
    const grants: CapabilityGrant[] = [
      { capabilityKey: "organisation.view", isPrivileged: false, isSatisfied: true },
      { capabilityKey: "worker.view", isPrivileged: false, isSatisfied: true },
    ];
    const build = (hasWorkerRecord: boolean) =>
      buildWorkspaceNavigation({
        organisationId: ORG,
        organisationType: "agency",
        can: (capability) => capabilityState(grants, capability),
        hasWorkerRecord,
      }).flatMap((group) => group.items.map((item) => item.label));
    expect(build(false)).toEqual(["Overview", "Workforce", "Settings"]);
    expect(build(true)).toEqual(["Overview", "Timesheets", "Workforce", "Settings"]);
  });

  it.each(Object.keys(ROLE_GRANTS))("lists no invented or self-service route for %s", (role) => {
    const type: OrganisationType = role.startsWith("facility.") ? "facility" : "agency";
    const { labels, items } = navFor(role, type, { hasWorkerRecord: true });
    for (const label of FORBIDDEN_LABELS) expect(labels).not.toContain(label);
    for (const { href } of items) {
      expect(href.startsWith(`/app/organisations/${ORG}`)).toBe(true);
      expect(href).not.toMatch(/reports|notifications|my-shifts|my-credentials/);
    }
  });

  it("lists the real Settings route last for every workspace role (P0-E8-S9H)", () => {
    for (const role of Object.keys(ROLE_GRANTS)) {
      const type: OrganisationType = role.startsWith("facility.") ? "facility" : "agency";
      const { items } = navFor(role, type);
      expect(items.at(-1)).toMatchObject({
        label: "Settings",
        href: `/app/organisations/${ORG}/settings`,
        icon: "settings",
      });
    }
  });

  it("drops empty groups and labels visible group headings", () => {
    const { groups } = navFor("agency.scheduler", "agency");
    expect(groups.map((group) => group.label)).toEqual([
      "Operations",
      "People and compliance",
      "Administration",
    ]);
    expect(groups.every((group) => group.items.length > 0)).toBe(true);
  });
});

describe("isWorkspaceStaff", () => {
  it("keeps self-service-only members (workers) out of the operational shell", () => {
    expect(isWorkspaceStaff(ROLE_GRANTS["agency.healthcare_worker"] ?? [])).toBe(false);
    expect(isWorkspaceStaff([])).toBe(false);
  });

  it.each(Object.keys(ROLE_GRANTS).filter((role) => role !== "agency.healthcare_worker"))(
    "treats %s as workspace staff",
    (role) => {
      expect(isWorkspaceStaff(ROLE_GRANTS[role] ?? [])).toBe(true);
    },
  );
});

describe("isNavItemActive", () => {
  const base = `/app/organisations/${ORG}`;
  const overview = { label: "Overview", href: base, icon: "overview", match: "exact" } as const;
  const shifts = {
    label: "Shifts",
    href: `${base}/shifts`,
    icon: "shifts",
    match: "prefix",
  } as const;

  it("matches the Overview exactly, so it is not active on every page", () => {
    expect(isNavItemActive(overview, base)).toBe(true);
    expect(isNavItemActive(overview, `${base}/shifts`)).toBe(false);
  });

  it("keeps a section active on its detail pages, without false prefix matches", () => {
    expect(isNavItemActive(shifts, `${base}/shifts`)).toBe(true);
    expect(isNavItemActive(shifts, `${base}/shifts/abc`)).toBe(true);
    expect(isNavItemActive(shifts, `${base}/shifts-archive`)).toBe(false);
  });
});
