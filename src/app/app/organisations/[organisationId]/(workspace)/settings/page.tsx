import type { Metadata, Route } from "next";
import Link from "next/link";

import { KeyValueList } from "@/components/ui/key-value-list";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { getAttendanceRules } from "@/features/attendance";
import { listRequirements } from "@/features/compliance";
import { getFinancialSettings } from "@/features/financial";
import {
  getOrganisationCurrency,
  listCurrencies,
  listMyMemberships,
  listRoles,
  loadOrganisationPage,
  OrganisationCurrencyForm,
  OrganisationLocaleForm,
} from "@/features/organisations";
import { getTimesheetWeekStart } from "@/features/timesheets";
import { CAPABILITIES } from "@/lib/authz";
import { PAYROLL_PERIOD_TYPE_LABELS } from "@/lib/domain/financial";
import { WEEKDAY_LABELS } from "@/lib/domain/timesheets";

import { settingsHref } from "./_components/settings-sections";
import { spell } from "@/features/localization";

export const metadata: Metadata = { title: "Settings" };

const TYPE_LABEL = { agency: "Agency", facility: "Facility" } as const;
const STATUS_LABEL: Record<string, string> = { active: "Active", suspended: "Suspended" };

/**
 * Settings → Organization. Workspace details are read-only: Chelth has no
 * mutation for the organisation name or type, so there is no form and no
 * Save button. Operational preferences summarise the real defaults the caller
 * can read, each linked to the section (or page) where it is changed.
 */
export default async function SettingsOrganizationPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/settings">) {
  const context = await loadOrganisationPage((await params).organisationId);
  const { organisationId, organisation, can } = context;
  const agency = organisation.type === "agency";
  const canAttendanceSettings =
    agency && can(CAPABILITIES.ATTENDANCE_MANAGE_SETTINGS) === "granted";
  const canPayroll = agency && can(CAPABILITIES.PAYROLL_VIEW) === "granted";
  const canRequirements = agency && can(CAPABILITIES.CREDENTIAL_REQUIREMENTS_VIEW) === "granted";

  const [memberships, roles, rules, weekStartsOn, financial, requirements] = await Promise.all([
    listMyMemberships(),
    listRoles(organisation.type),
    canAttendanceSettings ? getAttendanceRules(organisationId) : Promise.resolve(null),
    canAttendanceSettings ? getTimesheetWeekStart(organisationId) : Promise.resolve(null),
    canPayroll ? getFinancialSettings(organisationId) : Promise.resolve(null),
    canRequirements ? listRequirements(organisationId) : Promise.resolve(null),
  ]);
  // P0-E9-3I Language & Region: organisation.manage (AAL2). Currency applies to agencies.
  const languageRegion =
    can(CAPABILITIES.ORGANISATION_MANAGE) === "granted"
      ? {
          currency: agency
            ? await getOrganisationCurrency(organisationId, organisation.locale)
            : null,
          currencies: agency ? await listCurrencies() : [],
        }
      : null;
  const roleName = new Map(roles.map((role) => [role.key, role.name]));
  const myRoles =
    memberships
      .find((membership) => membership.organisation?.id === organisationId)
      ?.roleKeys.map((key) => roleName.get(key) ?? key) ?? [];

  const change = (segment: string, label: string) => (
    <Link
      href={settingsHref(organisationId, segment) as Route}
      className="ml-2 text-[13px] font-semibold text-primary underline underline-offset-4"
    >
      Change<span className="sr-only"> {label}</span>
    </Link>
  );
  const preferences = [
    ...(weekStartsOn !== null
      ? [
          {
            label: "Timesheet week starts on",
            value: (
              <>
                {WEEKDAY_LABELS[weekStartsOn] ?? "—"}
                {change("payroll", "timesheet week start")}
              </>
            ),
          },
        ]
      : []),
    ...(financial
      ? [
          {
            label: "Payroll period",
            value: financial.configured
              ? PAYROLL_PERIOD_TYPE_LABELS[financial.payrollPeriodType]
              : "Not set up yet",
          },
          {
            label: "Second approver (finance)",
            value: financial.makerCheckerRequired ? "Required" : "Not required",
          },
        ]
      : []),
    ...(rules
      ? [
          {
            label: "Late clock-in after",
            value: (
              <>
                {rules.lateClockInMinutes} minutes past the start
                {rules.isDefault ? " (Chelth default)" : ""}
                {change("attendance", "attendance rules")}
              </>
            ),
          },
          {
            label: "Geofencing for worker check-in",
            value: (
              <>
                {rules.geofencePolicy.requireGeofence ? "Required" : "Optional"}
                {change("attendance", "geofencing")}
              </>
            ),
          },
          {
            label: "Raw location evidence kept",
            value: (
              <>
                {rules.retentionDays} days
                {change("attendance", "location evidence retention")}
              </>
            ),
          },
        ]
      : []),
    ...(requirements
      ? [
          {
            label: "Baseline credential requirements",
            value: (
              <>
                {requirements.filter((requirement) => requirement.status === "active").length}{" "}
                active
                {change("compliance", "credential requirements")}
              </>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <Panel
        titleId="workspace-details-heading"
        title={<>Workspace Details</>}
        description={<>{spell("Basic information about your organization and workspace.")}</>}
      >
        <KeyValueList
          className="max-w-3xl"
          items={[
            { label: "Workspace name", value: organisation.name },
            { label: "Workspace type", value: TYPE_LABEL[organisation.type] },
            {
              label: "Status",
              value: (
                <StatusChip tone={organisation.status === "active" ? "success" : "warning"}>
                  {STATUS_LABEL[organisation.status] ?? organisation.status}
                </StatusChip>
              ),
            },
            {
              label: "Workspace ID",
              value: <span className="font-mono text-[13px] break-all">{organisation.id}</span>,
            },
            { label: "Your roles", value: myRoles.length > 0 ? myRoles.join(", ") : "—" },
          ]}
        />
        <p className="max-w-[68ch] text-[13.5px] leading-[21px] text-slate-600">
          The workspace name and type are set when the workspace is created and cannot be changed
          here.
        </p>
      </Panel>

      {languageRegion ? (
        <Panel
          titleId="workspace-language-heading"
          title={<>Language &amp; Region</>}
          description={
            <>Wording and money settings. Stored records and identifiers never change.</>
          }
        >
          <div className="flex flex-col gap-1">
            <h3 className="text-[15px] font-semibold text-chelth-navy">
              Language &amp; terminology
            </h3>
            <OrganisationLocaleForm organisationId={organisationId} locale={organisation.locale} />
          </div>
          {languageRegion.currency ? (
            <div className="flex flex-col gap-1 border-t border-[rgba(18,107,103,0.12)] pt-4">
              <h3 className="text-[15px] font-semibold text-chelth-navy">Regional finance</h3>
              <OrganisationCurrencyForm
                organisationId={organisationId}
                currency={languageRegion.currency}
                currencies={languageRegion.currencies}
              />
            </div>
          ) : null}
        </Panel>
      ) : null}

      {preferences.length > 0 ? (
        <Panel
          titleId="operational-preferences-heading"
          title={<>Operational Preferences</>}
          description={
            <>Current defaults for how your workspace operates. Each is changed in its section.</>
          }
        >
          <KeyValueList className="max-w-3xl" items={preferences} />
        </Panel>
      ) : null}
    </>
  );
}
