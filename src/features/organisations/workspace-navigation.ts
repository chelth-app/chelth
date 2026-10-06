import {
  CAPABILITIES,
  type CapabilityKey,
  type CapabilityState,
  type OrganisationType,
} from "@/lib/authz";
import type {
  WorkspaceNavGroup,
  WorkspaceNavIcon,
  WorkspaceNavItem,
} from "@/components/layout/workspace-navigation-model";

/**
 * Workspace navigation for the shared Agency / Facility shell (P0-E8-S1).
 *
 * Capability-driven, never role-driven: an item is listed only when the page
 * it links to would render for the caller — the same predicate as the page
 * gate (`requireCapabilityOrNotFound`: held = granted or pending step-up) and
 * as the organisation hub's section links. It is a UI hint only; every page
 * and operation is still re-authorised by the server and the database.
 *
 * Only existing routes are listed. There is deliberately no Reports,
 * Notifications, agency Credentials register or agency Staffing Requests
 * entry: those routes do not exist. Settings (P0-E8-S9H) is listed for every
 * workspace member: its Organization and Security sections apply to all, and
 * each other section applies its own capability gate. Self-service worker pages
 * (My shifts, My credentials) are not part of the operational shell; they
 * stay on the personal frame and remain linked from the Overview.
 */
export type WorkspaceNavigationInput = {
  organisationId: string;
  organisationType: OrganisationType;
  can: (capability: CapabilityKey) => CapabilityState;
  /** The caller has their own worker record in this agency (own timesheets). */
  hasWorkerRecord: boolean;
};

const held = (state: CapabilityState) => state !== "not_held";

/**
 * The Finance workspace (P0-E8-F2.5): four existing route families under one
 * sidebar item, in this locked order — Rates (define pay and bill), Pricing
 * (apply them to approved work), Payroll (worker-side output), Invoices
 * (facility-side output). Each area is listed only when its page gate would
 * pass (the same capability, held = granted or pending step-up).
 */
export const FINANCE_AREAS = [
  { key: "rates", label: "Rates", capability: CAPABILITIES.RATES_VIEW },
  { key: "pricing", label: "Pricing", capability: CAPABILITIES.PRICING_VIEW },
  { key: "payroll", label: "Payroll", capability: CAPABILITIES.PAYROLL_VIEW },
  { key: "invoices", label: "Invoices", capability: CAPABILITIES.INVOICE_VIEW },
] as const;

export type FinanceArea = (typeof FINANCE_AREAS)[number]["key"];

/** The finance areas the caller may open, in the locked order (agency workspaces only). */
export function financeAreas(
  organisationType: OrganisationType,
  can: (capability: CapabilityKey) => CapabilityState,
): { key: FinanceArea; label: string }[] {
  if (organisationType !== "agency") return [];
  return FINANCE_AREAS.filter((area) => held(can(area.capability))).map(({ key, label }) => ({
    key,
    label,
  }));
}

export function buildWorkspaceNavigation({
  organisationId,
  organisationType,
  can,
  hasWorkerRecord,
}: WorkspaceNavigationInput): WorkspaceNavGroup[] {
  const base = `/app/organisations/${organisationId}`;
  const item = (
    label: string,
    path: string,
    icon: WorkspaceNavIcon,
    match: WorkspaceNavItem["match"] = "prefix",
  ): WorkspaceNavItem => ({ label, href: path ? `${base}/${path}` : base, icon, match });
  const has = (capability: CapabilityKey) => held(can(capability));
  const compact = (items: (WorkspaceNavItem | false)[]) =>
    items.filter((entry): entry is WorkspaceNavItem => entry !== false);

  const overview = item("Overview", "", "overview", "exact");
  // One Finance item: it opens the first finance area the caller can open and
  // stays current on every route of all four areas (no Finance route exists).
  const finance = financeAreas(organisationType, can);
  const [firstFinance] = finance;
  const settings: WorkspaceNavGroup = {
    label: "Administration",
    visibleLabel: false,
    items: [item("Settings", "settings", "settings")],
  };

  if (organisationType === "facility") {
    return [
      {
        label: "Workspace",
        visibleLabel: false,
        items: compact([
          overview,
          has(CAPABILITIES.SHIFT_VIEW) &&
            item("Staffing requests", "staffing-requests", "requests"),
          has(CAPABILITIES.TIMESHEET_FACILITY_SIGNOFF) &&
            item("Timesheet sign-off", "timesheets", "timesheets"),
        ]),
      },
      settings,
    ];
  }

  const groups: WorkspaceNavGroup[] = [
    {
      label: "Operations",
      visibleLabel: false,
      items: compact([
        overview,
        has(CAPABILITIES.ASSIGNMENT_VIEW) && item("Operations", "operations", "operations"),
        has(CAPABILITIES.SHIFT_VIEW) && item("Shifts", "shifts", "shifts"),
        has(CAPABILITIES.ATTENDANCE_VIEW) && item("Attendance", "attendance", "attendance"),
        (has(CAPABILITIES.TIMESHEET_VIEW) || hasWorkerRecord) &&
          item("Timesheets", "timesheets", "timesheets"),
      ]),
    },
    {
      label: "People and compliance",
      visibleLabel: true,
      items: compact([
        has(CAPABILITIES.WORKER_VIEW) && item("Workforce", "workforce", "workforce"),
        has(CAPABILITIES.FACILITY_VIEW) && item("Facilities", "facilities", "facilities"),
        has(CAPABILITIES.CREDENTIAL_REQUIREMENTS_VIEW) &&
          item("Compliance", "compliance", "compliance"),
      ]),
    },
    {
      label: "Finance",
      visibleLabel: false,
      items: firstFinance
        ? [
            {
              ...item("Finance", firstFinance.key, "payroll"),
              activePaths: finance.map((area) => `${base}/${area.key}`),
            },
          ]
        : [],
    },
    settings,
  ];
  return groups.filter((group) => group.items.length > 0);
}

/**
 * Who the workspace shell is for. Members whose only grant is
 * `organisation.view` (agency healthcare workers) are self-service users:
 * they keep the existing simple frame and are not moved into the operational
 * shell (worker mobile experience is a separate, later stage).
 */
export function isWorkspaceStaff(grantKeys: readonly string[]): boolean {
  return grantKeys.some((key) => key !== CAPABILITIES.ORGANISATION_VIEW);
}
