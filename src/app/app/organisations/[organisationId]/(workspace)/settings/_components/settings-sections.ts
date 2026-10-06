import type { WorkspaceNavIcon } from "@/components/layout/workspace-navigation-model";
import {
  CAPABILITIES,
  type CapabilityKey,
  type CapabilityState,
  type OrganisationType,
} from "@/lib/authz";

/*
 * Settings sections (locked Settings reference sub-navigation), limited to
 * configuration Chelth actually has. Each section is listed only when its page
 * would render for the caller — the same predicate as the page gate. UI hint
 * only: every page and mutation is re-authorised by the server and database.
 *
 * Reference sections without a backend are deliberately absent: Notifications
 * (no preference model; in-app notifications are a backlog feature), Shifts &
 * Scheduling (no scheduling settings), Integrations (none implemented) and
 * workspace lifecycle (no archive/deactivate workflow).
 */

export type SettingsSectionKey =
  "organization" | "team" | "attendance" | "payroll" | "rates" | "compliance" | "security";

export type SettingsSection = {
  key: SettingsSectionKey;
  label: string;
  /** Path segment under /settings ("" for the landing section). */
  segment: string;
  icon: WorkspaceNavIcon;
};

const ALL: SettingsSection[] = [
  { key: "organization", label: "Organization", segment: "", icon: "facilities" },
  { key: "team", label: "Team & Permissions", segment: "team", icon: "workforce" },
  {
    key: "attendance",
    label: "Attendance & Geofencing",
    segment: "attendance",
    icon: "attendance",
  },
  { key: "payroll", label: "Timesheets & Payroll", segment: "payroll", icon: "timesheets" },
  { key: "rates", label: "Rates & Billing", segment: "rates", icon: "rates" },
  {
    key: "compliance",
    label: "Credentials & Compliance",
    segment: "compliance",
    icon: "compliance",
  },
  { key: "security", label: "Security", segment: "security", icon: "settings" },
];

const held = (state: CapabilityState) => state !== "not_held";

/** Whether the caller may open a section (granted or pending step-up). */
export function canOpenSection(
  key: SettingsSectionKey,
  organisationType: OrganisationType,
  can: (capability: CapabilityKey) => CapabilityState,
): boolean {
  const agency = organisationType === "agency";
  switch (key) {
    case "organization":
    case "security":
      return true;
    case "team":
      return (
        held(can(CAPABILITIES.MEMBERSHIP_VIEW)) ||
        held(can(CAPABILITIES.MEMBERSHIP_INVITE)) ||
        held(can(CAPABILITIES.ROLE_ASSIGN))
      );
    case "attendance":
      return agency && held(can(CAPABILITIES.ATTENDANCE_MANAGE_SETTINGS));
    case "payroll":
      return (
        agency &&
        (held(can(CAPABILITIES.ATTENDANCE_MANAGE_SETTINGS)) ||
          (held(can(CAPABILITIES.PAYROLL_APPROVE)) && held(can(CAPABILITIES.INVOICE_APPROVE))))
      );
    case "rates":
      return agency && held(can(CAPABILITIES.RATES_VIEW));
    case "compliance":
      return agency && held(can(CAPABILITIES.CREDENTIAL_REQUIREMENTS_VIEW));
  }
}

export function visibleSections(
  organisationType: OrganisationType,
  can: (capability: CapabilityKey) => CapabilityState,
): SettingsSection[] {
  return ALL.filter((section) => canOpenSection(section.key, organisationType, can));
}

export function settingsHref(organisationId: string, section: SettingsSection | string): string {
  const segment = typeof section === "string" ? section : section.segment;
  const base = `/app/organisations/${organisationId}/settings`;
  return segment ? `${base}/${segment}` : base;
}
