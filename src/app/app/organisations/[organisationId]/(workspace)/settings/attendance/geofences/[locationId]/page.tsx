import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { KeyValueList } from "@/components/ui/key-value-list";
import { Panel } from "@/components/ui/panel";
import {
  GeofenceForm,
  GeofenceReadinessBadge,
  getAttendanceRules,
  listGeofenceReadiness,
  listLocationGeofences,
} from "@/features/attendance";
import { getFacility } from "@/features/facilities";
import { loadOrganisationPage, StepUpNotice } from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";
import {
  checkInBlockedByConfiguration,
  GEOFENCE_POLICY_SHORT_LABELS,
} from "@/lib/domain/attendance";

import { canOpenSection, settingsHref } from "../../../_components/settings-sections";

export const metadata: Metadata = { title: "Location Geofence" };

/**
 * Settings → Attendance & Geofencing → one facility location's geofence
 * (P0-E9-3E.1). Operators only (attendance.manage_settings, AAL2; the
 * database re-checks). The form prefills from the agency defaults when the
 * location has no geofence; the site centre is always confirmed by hand.
 */
export default async function LocationGeofencePage({
  params,
}: PageProps<"/app/organisations/[organisationId]/settings/attendance/geofences/[locationId]">) {
  const { organisationId: rawOrganisationId, locationId: rawLocationId } = await params;
  const context = await loadOrganisationPage(rawOrganisationId);
  const { organisationId, organisation, can } = context;
  if (!canOpenSection("attendance", organisation.type, can)) notFound();
  const locationId = z.uuid().safeParse(rawLocationId);
  if (!locationId.success || can(CAPABILITIES.FACILITY_VIEW) !== "granted") notFound();
  const backHref = settingsHref(organisationId, "attendance");

  if (can(CAPABILITIES.ATTENDANCE_MANAGE_SETTINGS) !== "granted") {
    return (
      <StepUpNotice
        returnTo={settingsHref(organisationId, `attendance/geofences/${locationId.data}`)}
      >
        Changing a location&apos;s geofence requires verification with your authenticator app.
      </StepUpNotice>
    );
  }

  const [rules, locations] = await Promise.all([
    getAttendanceRules(organisationId),
    listGeofenceReadiness(organisationId),
  ]);
  const location = locations.find((row) => row.locationId === locationId.data);
  if (!location) notFound();
  const [facility, geofences] = await Promise.all([
    getFacility(organisationId, location.facilityId),
    listLocationGeofences(location.facilityId),
  ]);
  const policy = rules.geofencePolicy;
  const current = geofences.find((geofence) => geofence.locationId === location.locationId) ?? null;
  const blocked = checkInBlockedByConfiguration(policy.requireGeofence, location.readiness);
  const address = facility
    ? [facility.addressLine1, facility.locality, facility.region, facility.postalCode]
        .filter(Boolean)
        .join(", ")
    : "";

  return (
    <>
      <p className="text-[13.5px]">
        <Link href={backHref as Route} className="text-primary underline underline-offset-4">
          Attendance &amp; Geofencing
        </Link>
      </p>

      <Panel
        titleId="location-readiness-heading"
        title={<>Worker Check-In Readiness</>}
        description={
          <>
            {location.facilityName} · {location.locationName}
          </>
        }
      >
        <KeyValueList
          className="max-w-3xl"
          items={[
            {
              label: "Geofence",
              value: (
                <GeofenceReadinessBadge
                  readiness={location.readiness}
                  requireGeofence={policy.requireGeofence}
                />
              ),
            },
            {
              label: "Radius",
              value: location.radiusMeters !== null ? `${location.radiusMeters} m` : "—",
            },
            {
              label: "GPS accuracy",
              value:
                location.maxAccuracyMeters !== null ? `≤ ${location.maxAccuracyMeters} m` : "—",
            },
            {
              label: "Policy",
              value: location.outsidePolicy
                ? GEOFENCE_POLICY_SHORT_LABELS[location.outsidePolicy]
                : "—",
            },
          ]}
        />
        {blocked ? (
          <p
            role="note"
            className="max-w-[68ch] rounded-[10px] border border-[rgba(229,72,77,0.18)] bg-danger-soft/50 px-3.5 py-2.5 text-[13.5px] leading-[21px] text-slate-700"
          >
            Geofencing must be configured before this location is ready for worker check-in. Workers
            cannot check in here until it is set up and enabled.
          </p>
        ) : location.readiness === "not_blocking" ? (
          <p className="max-w-[68ch] text-[13.5px] leading-[21px] text-slate-600">
            Precise readings outside the area are recorded and flagged for review rather than
            blocked, so this location does not count towards pilot readiness.
          </p>
        ) : null}
      </Panel>

      <Panel
        titleId="location-geofence-heading"
        title={<>Manage Geofence</>}
        description={
          <>
            {address ? `${address}. ` : ""}Set the site centre (for example the main entrance) and
            how close and how precise a worker&apos;s reading must be. Workers never see these
            values.
          </>
        }
      >
        <GeofenceForm
          organisationId={organisationId}
          facilityId={location.facilityId}
          locationId={location.locationId}
          locationName={location.locationName}
          current={current}
          policy={policy}
        />
      </Panel>
    </>
  );
}
