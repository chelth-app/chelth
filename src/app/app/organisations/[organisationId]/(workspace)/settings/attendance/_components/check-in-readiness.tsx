import { KeyValueList } from "@/components/ui/key-value-list";
import { StatusChip } from "@/components/ui/status-chip";
import type { GeofenceReadinessSummary } from "@/lib/domain/attendance";

const REASON: Record<NonNullable<GeofenceReadinessSummary["reason"]>, string> = {
  not_required:
    "Geofencing is optional for this workspace, so locations without a geofence check in without a location check. Turn on “Require geofencing for worker check-in” for a pilot.",
  no_locations: "No active facility locations yet.",
  locations_need_setup:
    "Geofencing must be configured before each location is ready for worker check-in.",
};

/**
 * Worker check-in readiness for operators (never shown to workers): READY only
 * when geofencing is required and every active location has an enabled,
 * blocking geofence. Presentation of summariseGeofenceReadiness.
 */
export function CheckInReadinessSummary({
  requireGeofence,
  summary,
}: {
  requireGeofence: boolean;
  summary: GeofenceReadinessSummary;
}) {
  const ready = summary.status === "ready";
  return (
    <div className="flex flex-col gap-3">
      <KeyValueList
        className="max-w-3xl"
        items={[
          {
            label: "Pilot geofence readiness",
            value: (
              <StatusChip tone={ready ? "success" : "warning"}>
                {ready ? "Ready" : "Not ready"}
              </StatusChip>
            ),
          },
          {
            label: "Geofencing for check-in",
            value: requireGeofence ? "Required" : "Optional",
          },
          { label: "Active locations", value: summary.activeLocations },
          { label: "Blocking geofences set up", value: summary.blockingLocations },
          ...(requireGeofence
            ? [
                {
                  label: "Locations where check-in is unavailable",
                  value: summary.blockedLocations,
                },
              ]
            : []),
        ]}
      />
      {summary.reason ? (
        <p className="max-w-[68ch] text-[13.5px] leading-[21px] text-slate-600">
          {REASON[summary.reason]}
        </p>
      ) : null}
    </div>
  );
}
