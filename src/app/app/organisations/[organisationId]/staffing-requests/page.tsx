import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { listDisciplines } from "@/features/credentials";
import { listPartnerRelationships } from "@/features/facilities";
import { loadOrganisationPage, requireCapabilityOrNotFound } from "@/features/organisations";
import {
  decodeCursor,
  FacilityRequestForm,
  FillBadge,
  listFacilityShiftsPage,
  listRequestLocations,
  ShiftStatusBadge,
} from "@/features/shifts";
import { CAPABILITIES } from "@/lib/authz";
import {
  formatShiftDate,
  formatShiftTimeRange,
  SHIFT_SOURCE_LABELS,
  todayIsoDate,
} from "@/lib/domain/shifts";

export const metadata: Metadata = { title: "Staffing requests" };

/**
 * Facility side: requests and shifts under this facility's explicit agency
 * relationships only (narrow projection). No agency-wide screens.
 */
export default async function StaffingRequestsPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/staffing-requests">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.SHIFT_VIEW);
  const { organisationId, organisation, can } = context;
  if (organisation.type !== "facility") notFound();

  const canRequest = can(CAPABILITIES.SHIFT_REQUEST) === "granted";
  const after = (await searchParams).after;
  const cursor = decodeCursor(typeof after === "string" ? after : undefined);
  const [page, relationships, disciplines] = await Promise.all([
    listFacilityShiftsPage(organisationId, cursor),
    canRequest && can(CAPABILITIES.RELATIONSHIP_VIEW) === "granted"
      ? listPartnerRelationships(organisationId)
      : Promise.resolve([]),
    canRequest ? listDisciplines() : Promise.resolve([]),
  ]);
  const shifts = page.items;
  const options = (
    await Promise.all(
      relationships
        .filter((relationship) => relationship.status === "active")
        .map(async (relationship) =>
          (await listRequestLocations(relationship.relationshipId)).map((location) => ({
            relationshipId: relationship.relationshipId,
            agencyName: relationship.agencyName,
            locationId: location.locationId,
            locationName: location.name,
            timezone: location.timezone,
          })),
        ),
    )
  ).flat();

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          {organisation.name}
        </Link>
        <h1 className="text-2xl font-semibold">Staffing requests</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Request staff from your partner agencies and follow how each request is being filled.
        </p>
      </header>

      <section aria-labelledby="requests-heading" className="flex flex-col gap-3">
        <h2 id="requests-heading" className="text-lg font-semibold">
          Requests and shifts
        </h2>
        {shifts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {shifts.map((shift) => (
              <li
                key={shift.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/app/organisations/${organisationId}/staffing-requests/${shift.id}`}
                    className="font-medium text-primary underline underline-offset-4"
                  >
                    {shift.agencyName} · {shift.disciplineName} · {formatShiftDate(shift)}
                  </Link>
                  <div className="flex flex-wrap gap-2">
                    <ShiftStatusBadge status={shift.status} />
                    {shift.status === "open" ? (
                      <FillBadge
                        fillState={shift.fillState}
                        activeCount={shift.activeCount}
                        requestedHeadcount={shift.requestedHeadcount}
                      />
                    ) : null}
                    <Badge tone="neutral">{SHIFT_SOURCE_LABELS[shift.source]}</Badge>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {shift.locationName} · {formatShiftTimeRange(shift)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {page.nextCursor ? (
          <nav aria-label="Request list pages" className="text-sm">
            <Link
              href={`/app/organisations/${organisationId}/staffing-requests?after=${page.nextCursor}`}
              className="text-primary underline underline-offset-4"
            >
              Older requests
            </Link>
          </nav>
        ) : null}
      </section>

      {canRequest ? (
        <section aria-labelledby="new-request-heading" className="flex flex-col gap-3">
          <h2 id="new-request-heading" className="text-lg font-semibold">
            Request staff
          </h2>
          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You need an active relationship with an agency, and the agency must have set up your
              locations, before you can request staff.
            </p>
          ) : (
            <FacilityRequestForm
              organisationId={organisationId}
              options={options}
              disciplines={disciplines}
              minDate={todayIsoDate()}
            />
          )}
        </section>
      ) : null}
    </>
  );
}
