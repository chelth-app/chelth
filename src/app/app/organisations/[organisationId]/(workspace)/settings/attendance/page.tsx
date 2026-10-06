import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Panel } from "@/components/ui/panel";
import { AttendanceSettingsForm, getAttendanceRules, RetentionForm } from "@/features/attendance";
import { loadOrganisationPage, StepUpNotice } from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";

import { canOpenSection, settingsHref } from "../_components/settings-sections";
import { SettingsActionLink, SettingsActionRow } from "../_components/settings-ui";

export const metadata: Metadata = { title: "Attendance & Geofencing" };

/**
 * Settings → Attendance & Geofencing. The existing agency attendance rules and
 * location-evidence retention forms (moved from the Attendance page,
 * P0-E8-S9H), with the same server validation bounds. Geofences are set per
 * facility location; there is no workspace-wide geofence default.
 */
export default async function SettingsAttendancePage({
  params,
}: PageProps<"/app/organisations/[organisationId]/settings/attendance">) {
  const context = await loadOrganisationPage((await params).organisationId);
  const { organisationId, organisation, can } = context;
  if (!canOpenSection("attendance", organisation.type, can)) notFound();
  const manage = can(CAPABILITIES.ATTENDANCE_MANAGE_SETTINGS);
  const rules = manage === "granted" ? await getAttendanceRules(organisationId) : null;

  return (
    <>
      {manage === "step_up_required" ? (
        <StepUpNotice returnTo={settingsHref(organisationId, "attendance")}>
          Changing attendance rules requires verification with your authenticator app.
        </StepUpNotice>
      ) : null}

      {rules ? (
        <>
          <Panel
            titleId="rules-heading"
            title={<>Check-In Rules</>}
            description={
              <>
                {rules.isDefault ? "Chelth defaults are in use. " : ""}When clock-in opens and when
                a clock-in or clock-out is flagged for review. Changes apply to future attendance;
                recorded events are never rewritten.
              </>
            }
          >
            <AttendanceSettingsForm organisationId={organisationId} rules={rules} />
          </Panel>

          <Panel
            titleId="retention-heading"
            title={<>Location Evidence Retention</>}
            description={
              <>
                Raw coordinates from clock actions are purged after this period unless a legal hold
                applies. Confirm the period with your legal adviser before production use.
              </>
            }
          >
            <RetentionForm organisationId={organisationId} retentionDays={rules.retentionDays} />
          </Panel>
        </>
      ) : null}

      <Panel
        titleId="geofence-heading"
        title={<>Geofence Defaults</>}
        description={
          <>
            Location checks are configured per facility location — site position, radius, required
            accuracy and what happens outside the area. They are off unless a location enables them.
          </>
        }
      >
        {can(CAPABILITIES.FACILITY_VIEW) !== "not_held" ? (
          <SettingsActionRow>
            <SettingsActionLink
              href={`/app/organisations/${organisationId}/facilities`}
              icon="facilities"
            >
              Manage location checks on Facilities
            </SettingsActionLink>
          </SettingsActionRow>
        ) : (
          <p className="text-[13.5px] text-slate-600">Your role cannot open facility settings.</p>
        )}
      </Panel>
    </>
  );
}
