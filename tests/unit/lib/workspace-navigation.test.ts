import { describe, expect, it } from "vitest";

import { isNavItemActive } from "@/components/layout/workspace-navigation-model";
import {
  buildWorkspaceNavigation,
  financeAreas,
  isWorkspaceStaff,
  workerOnlyAgencies,
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
    "message.send",
    "message.view",
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
    "message.send",
    "message.view",
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
    "message.send",
    "message.view",
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
      "Messages",
      "Workforce",
      "Facilities",
      "Compliance",
      "Finance",
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
      "Messages",
      "Workforce",
      "Facilities",
      "Settings",
    ]);
  });

  it("gives agency finance one Finance item and no operational ones", () => {
    expect(navFor("agency.finance", "agency").labels).toEqual([
      "Overview",
      "Timesheets",
      "Facilities",
      "Finance",
      "Settings",
    ]);
  });

  it("gives a facility admin requests, timesheet sign-off and messages only", () => {
    expect(navFor("facility.admin", "facility").labels).toEqual([
      "Overview",
      "Staffing requests",
      "Sign-off",
      "Messages",
      "Settings",
    ]);
  });

  it("gives a facility scheduler requests and messages without sign-off", () => {
    expect(navFor("facility.scheduler", "facility").labels).toEqual([
      "Overview",
      "Staffing requests",
      "Messages",
      "Settings",
    ]);
  });

  it("gives a facility supervisor view routes only", () => {
    expect(navFor("facility.supervisor", "facility").labels).toEqual([
      "Overview",
      "Staffing requests",
      "Sign-off",
      "Settings",
    ]);
  });

  it("never lists agency routes in a facility workspace, even with every capability", () => {
    const { labels } = navFor("agency.admin", "facility");
    expect(labels).toEqual(["Overview", "Staffing requests", "Sign-off", "Messages", "Settings"]);
  });

  it("lists capabilities pending MFA step-up (the page renders a step-up notice)", () => {
    expect(navFor("agency.finance", "agency", { stepUp: true }).labels).toContain("Finance");
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

  it("never lists the four finance areas as separate sidebar items (P0-E8-F2.5)", () => {
    for (const role of Object.keys(ROLE_GRANTS)) {
      const type: OrganisationType = role.startsWith("facility.") ? "facility" : "agency";
      const { labels } = navFor(role, type);
      for (const label of ["Rates", "Pricing", "Payroll", "Invoices"]) {
        expect(labels).not.toContain(label);
      }
    }
  });

  it("shows Finance only when a finance area is held, linking to the first one", () => {
    const only = (keys: CapabilityKey[]) =>
      buildWorkspaceNavigation({
        organisationId: ORG,
        organisationType: "agency",
        can: (capability) =>
          capabilityState(
            ["organisation.view", ...keys].map((capabilityKey) => ({
              capabilityKey,
              isPrivileged: false,
              isSatisfied: true,
            })),
            capability,
          ),
        hasWorkerRecord: false,
      })
        .flatMap((group) => group.items)
        .find((item) => item.label === "Finance");
    expect(only([])).toBeUndefined();
    expect(only(["worker.view"])).toBeUndefined();
    expect(only(["rates.view"])?.href).toBe(`/app/organisations/${ORG}/rates`);
    expect(only(["payroll.view"])?.href).toBe(`/app/organisations/${ORG}/payroll`);
    expect(only(["invoice.view", "pricing.view"])?.href).toBe(`/app/organisations/${ORG}/pricing`);
    expect(only(["payroll.view", "invoice.view"])?.activePaths).toEqual([
      `/app/organisations/${ORG}/payroll`,
      `/app/organisations/${ORG}/invoices`,
    ]);
    expect(navFor("agency.scheduler", "agency").labels).not.toContain("Finance");
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

describe("financeAreas", () => {
  const grantsOf = (keys: CapabilityKey[]) => (capability: CapabilityKey) =>
    capabilityState(
      keys.map((capabilityKey) => ({ capabilityKey, isPrivileged: false, isSatisfied: true })),
      capability,
    );

  it("keeps the locked order Rates, Pricing, Payroll, Invoices", () => {
    expect(financeAreas("agency", grantsOf(ALL)).map((area) => area.label)).toEqual([
      "Rates",
      "Pricing",
      "Payroll",
      "Invoices",
    ]);
  });

  it("lists only the areas the caller can open, and none in a facility workspace", () => {
    expect(financeAreas("agency", grantsOf(["payroll.view"])).map((area) => area.key)).toEqual([
      "payroll",
    ]);
    expect(financeAreas("agency", grantsOf(["organisation.view"]))).toEqual([]);
    expect(financeAreas("facility", grantsOf(ALL))).toEqual([]);
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

  it("keeps Finance active on every route of its four areas, records included", () => {
    const finance = {
      label: "Finance",
      href: `${base}/rates`,
      icon: "payroll",
      match: "prefix",
      activePaths: ["rates", "pricing", "payroll", "invoices"].map((key) => `${base}/${key}`),
    } as const;
    for (const path of [
      "rates",
      "pricing",
      "pricing/abc",
      "payroll",
      "payroll/abc",
      "payroll/adjustments/abc",
      "invoices",
      "invoices/abc",
      "invoices/adjustments/abc",
    ]) {
      expect(isNavItemActive(finance, `${base}/${path}`), path).toBe(true);
    }
    expect(isNavItemActive(finance, `${base}/settings/payroll`)).toBe(false);
    expect(isNavItemActive(finance, `${base}/payroll-archive`)).toBe(false);
    expect(isNavItemActive(finance, `${base}/timesheets`)).toBe(false);
  });
});

describe("workerOnlyAgencies (P0-E9-3B app entry)", () => {
  const agency = (id: string) => ({ id, name: `Agency ${id}`, type: "agency" as const });
  const facility = { id: "f", name: "Facility f", type: "facility" as const };
  const WORKER = "agency.healthcare_worker";

  it("returns the one agency of a worker-only account", () => {
    expect(workerOnlyAgencies([{ organisation: agency("a"), roleKeys: [WORKER] }])).toEqual([
      { id: "a", name: "Agency a" },
    ]);
  });

  it("returns every agency, in order, for a worker of several agencies", () => {
    expect(
      workerOnlyAgencies([
        { organisation: agency("a"), roleKeys: [WORKER] },
        { organisation: agency("b"), roleKeys: [WORKER] },
      ]),
    ).toEqual([
      { id: "a", name: "Agency a" },
      { id: "b", name: "Agency b" },
    ]);
  });

  it("ignores memberships whose organisation is not visible", () => {
    expect(
      workerOnlyAgencies([
        { organisation: null, roleKeys: ["agency.admin"] },
        { organisation: agency("a"), roleKeys: [WORKER] },
      ]),
    ).toEqual([{ id: "a", name: "Agency a" }]);
  });

  it.each([
    ["an agency admin", [{ organisation: agency("a"), roleKeys: ["agency.admin"] }]],
    [
      "a worker who is also staff of the same agency",
      [{ organisation: agency("a"), roleKeys: [WORKER, "agency.scheduler"] }],
    ],
    [
      "a worker who is staff of another agency",
      [
        { organisation: agency("a"), roleKeys: [WORKER] },
        { organisation: agency("b"), roleKeys: ["agency.finance"] },
      ],
    ],
    [
      "a worker who is also a facility member",
      [
        { organisation: agency("a"), roleKeys: [WORKER] },
        { organisation: facility, roleKeys: ["facility.supervisor"] },
      ],
    ],
    ["a facility member", [{ organisation: facility, roleKeys: ["facility.admin"] }]],
    ["a membership without roles", [{ organisation: agency("a"), roleKeys: [] }]],
    ["no memberships", []],
    ["only hidden memberships", [{ organisation: null, roleKeys: [WORKER] }]],
  ])("keeps the general gateway for %s", (_label, memberships) => {
    expect(workerOnlyAgencies(memberships)).toBeNull();
  });
});
