import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { Panel } from "@/components/ui/panel";
import {
  AttendanceSettingsForm,
  GeofencePolicyForm,
  GeofenceReadinessBadge,
  getAttendanceRules,
  listGeofenceReadiness,
  RetentionForm,
} from "@/features/attendance";
import { loadOrganisationPage, StepUpNotice } from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";
import { GEOFENCE_POLICY_SHORT_LABELS, summariseGeofenceReadiness } from "@/lib/domain/attendance";

import { canOpenSection, settingsHref } from "../_components/settings-sections";
import { SettingsActionLink } from "../_components/settings-ui";
import { CheckInReadinessSummary } from "./_components/check-in-readiness";

export const metadata: Metadata = { title: "Attendance & Geofencing" };

/**
 * Settings → Attendance & Geofencing. Geofencing (P0-E9-3E.1): the agency's
 * require-geofencing policy and defaults, worker check-in readiness, and each
 * facility location's geofence status. Geofences stay per location — the
 * defaults only prefill a location's setup. Then the existing attendance rules
 * and location-evidence retention forms, with the same server bounds.
 */
export default async function SettingsAttendancePage({
  params,
}: PageProps<"/app/organisations/[organisationId]/settings/attendance">) {
  const context = await loadOrganisationPage((await params).organisationId);
  const { organisationId, organisation, can } = context;
  if (!canOpenSection("attendance", organisation.type, can)) notFound();
  const manage = can(CAPABILITIES.ATTENDANCE_MANAGE_SETTINGS);
  const canViewLocations = can(CAPABILITIES.FACILITY_VIEW) === "granted";
  const [rules, locations] =
    manage === "granted"
      ? await Promise.all([
          getAttendanceRules(organisationId),
          canViewLocations ? listGeofenceReadiness(organisationId) : Promise.resolve(null),
        ])
      : [null, null];
  const policy = rules?.geofencePolicy;
  const manageHref = (locationId: string) =>
    settingsHref(organisationId, `attendance/geofences/${locationId}`);

  return (
    <>
      {manage === "step_up_required" ? (
        <StepUpNotice returnTo={settingsHref(organisationId, "attendance")}>
          Changing attendance rules requires verification with your authenticator app.
        </StepUpNotice>
      ) : null}

      {rules && policy ? (
        <>
          <Panel
            titleId="geofence-policy-heading"
            title={<>Geofencing Defaults</>}
            description={
              <>
                Whether worker check-in requires a configured geofence, and the values used when
                setting up a facility location.
              </>
            }
          >
            <GeofencePolicyForm organisationId={organisationId} policy={policy} />
          </Panel>

          {locations ? (
            <>
              <Panel
                titleId="check-in-readiness-heading"
                title={<>Worker Check-In Readiness</>}
                description={<>Whether every active location is ready for geofenced check-in.</>}
              >
                <CheckInReadinessSummary
                  requireGeofence={policy.requireGeofence}
                  summary={summariseGeofenceReadiness(locations, policy.requireGeofence)}
                />
              </Panel>

              <Panel
                titleId="facility-geofences-heading"
                title={<>Facility Geofences</>}
                description={
                  <>
                    Check-in uses each location&apos;s own geofence. Changing the defaults above
                    never changes a location that is already set up.
                  </>
                }
              >
                {locations.length === 0 ? (
                  <p className="text-[13.5px] text-slate-600">
                    No facility locations yet. Add a location on a facility to set up its geofence.
                  </p>
                ) : (
                  <DataTableRegion aria-label="Facility geofences table">
                    <DataTable className="min-w-[44rem]">
                      <DataTableHead>
                        <tr>
                          <DataTableHeaderCell>Facility</DataTableHeaderCell>
                          <DataTableHeaderCell>Location</DataTableHeaderCell>
                          <DataTableHeaderCell>Status</DataTableHeaderCell>
                          <DataTableHeaderCell>Radius</DataTableHeaderCell>
                          <DataTableHeaderCell>Accuracy</DataTableHeaderCell>
                          <DataTableHeaderCell>Policy</DataTableHeaderCell>
                          <DataTableHeaderCell>
                            <span className="sr-only">Action</span>
                          </DataTableHeaderCell>
                        </tr>
                      </DataTableHead>
                      <tbody>
                        {locations.map((location) => {
                          const configured = location.radiusMeters !== null;
                          return (
                            <DataTableRow key={location.locationId}>
                              <DataTableCell>{location.facilityName}</DataTableCell>
                              <th
                                scope="row"
                                className="px-3 py-2.5 text-left font-medium text-chelth-navy"
                              >
                                {location.locationName}
                                {location.locationActive ? null : (
                                  <span className="block text-[12.5px] font-normal text-slate-600">
                                    Inactive
                                  </span>
                                )}
                              </th>
                              <DataTableCell>
                                <GeofenceReadinessBadge
                                  readiness={location.readiness}
                                  requireGeofence={policy.requireGeofence}
                                />
                              </DataTableCell>
                              <DataTableCell numeric>
                                {configured ? `${location.radiusMeters} m` : "—"}
                              </DataTableCell>
                              <DataTableCell numeric>
                                {configured ? `${location.maxAccuracyMeters} m` : "—"}
                              </DataTableCell>
                              <DataTableCell>
                                {location.outsidePolicy
                                  ? GEOFENCE_POLICY_SHORT_LABELS[location.outsidePolicy]
                                  : "—"}
                              </DataTableCell>
                              <DataTableCell>
                                <SettingsActionLink
                                  href={manageHref(location.locationId)}
                                  size="sm"
                                >
                                  {configured ? "Manage" : "Set up geofence"}
                                  <span className="sr-only">
                                    {" "}
                                    for {location.facilityName} {location.locationName}
                                  </span>
                                </SettingsActionLink>
                              </DataTableCell>
                            </DataTableRow>
                          );
                        })}
                      </tbody>
                    </DataTable>
                  </DataTableRegion>
                )}
              </Panel>
            </>
          ) : null}

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
    </>
  );
}
