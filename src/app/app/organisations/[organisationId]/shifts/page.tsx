import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { listDisciplines } from "@/features/credentials";
import { loadOrganisationPage, requireCapabilityOrNotFound } from "@/features/organisations";
import {
  CreateShiftForm,
  FillBadge,
  listAgencyShifts,
  listFacilityFilterOptions,
  listSchedulableLocations,
  shiftFiltersSchema,
  ShiftStatusBadge,
} from "@/features/shifts";
import { CAPABILITIES } from "@/lib/authz";
import {
  formatShiftDate,
  formatShiftTimeRange,
  SHIFT_SOURCE_LABELS,
  SHIFT_STATUS_LABELS,
  SHIFT_STATUSES,
  todayIsoDate,
} from "@/lib/domain/shifts";

export const metadata: Metadata = { title: "Shifts" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

export default async function ShiftsPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/shifts">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.SHIFT_VIEW);
  const { organisationId, organisation, can } = context;
  if (organisation.type !== "agency") notFound();

  const raw = await searchParams;
  const filters = shiftFiltersSchema.parse({
    status: first(raw.status),
    facilityId: first(raw.facilityId),
    from: first(raw.from),
    to: first(raw.to),
  });
  const canCreate = can(CAPABILITIES.SHIFT_CREATE) === "granted";
  const [shifts, facilities, locations, disciplines] = await Promise.all([
    listAgencyShifts(organisationId, filters),
    listFacilityFilterOptions(organisationId),
    canCreate ? listSchedulableLocations(organisationId) : Promise.resolve([]),
    canCreate ? listDisciplines() : Promise.resolve([]),
  ]);

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          {organisation.name}
        </Link>
        <h1 className="text-2xl font-semibold">Shifts</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Work requested by and scheduled for your client facilities. Times are shown in each
          facility location&apos;s own timezone.
        </p>
      </header>

      <section aria-labelledby="shift-filters-heading" className="flex flex-col gap-3">
        <h2 id="shift-filters-heading" className="sr-only">
          Filter shifts
        </h2>
        <form method="get" className="grid gap-3 sm:grid-cols-5 sm:items-end">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-status">Status</Label>
            <Select id="filter-status" name="status" defaultValue={filters.status ?? ""}>
              <option value="">All statuses</option>
              {SHIFT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {SHIFT_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-facility">Facility</Label>
            <Select id="filter-facility" name="facilityId" defaultValue={filters.facilityId ?? ""}>
              <option value="">All facilities</option>
              {facilities.map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-from">From</Label>
            <Input id="filter-from" name="from" type="date" defaultValue={filters.from ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-to">To</Label>
            <Input id="filter-to" name="to" type="date" defaultValue={filters.to ?? ""} />
          </div>
          <Button type="submit" variant="outline" className="w-fit">
            Apply filters
          </Button>
        </form>
      </section>

      <section aria-labelledby="shift-list-heading" className="flex flex-col gap-3">
        <h2 id="shift-list-heading" className="text-lg font-semibold">
          Shift list
        </h2>
        {shifts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No shifts match.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {shifts.map((shift) => (
              <li
                key={shift.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/app/organisations/${organisationId}/shifts/${shift.id}`}
                    className="font-medium text-primary underline underline-offset-4"
                  >
                    {shift.facilityName} · {shift.disciplineName} · {formatShiftDate(shift)}
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
                    {shift.source === "facility" ? (
                      <Badge tone="info">{SHIFT_SOURCE_LABELS.facility}</Badge>
                    ) : null}
                    {shift.relationshipStatus !== "active" ? (
                      <Badge tone="warning">Relationship not active</Badge>
                    ) : null}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {shift.locationName} · {formatShiftTimeRange(shift)}
                  {shift.externalReference ? ` · Ref ${shift.externalReference}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canCreate ? (
        <section aria-labelledby="create-shift-heading" className="flex flex-col gap-3">
          <h2 id="create-shift-heading" className="text-lg font-semibold">
            Create a shift
          </h2>
          {locations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add a facility location and activate the facility relationship before scheduling.
            </p>
          ) : (
            <CreateShiftForm
              organisationId={organisationId}
              locations={locations}
              disciplines={disciplines}
              canOpen={can(CAPABILITIES.SHIFT_MANAGE) === "granted"}
              minDate={todayIsoDate()}
            />
          )}
        </section>
      ) : null}
    </>
  );
}
