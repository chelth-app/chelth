import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTablePagination,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField, FilterSelect } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { KeyValueList } from "@/components/ui/key-value-list";
import { KpiFilterCard, KpiFilterGroup } from "@/components/ui/kpi-filter-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { listDisciplines } from "@/features/credentials";
import { loadOrganisationPage, requireCapabilityOrNotFound } from "@/features/organisations";
import {
  CreateShiftForm,
  decodeCursor,
  FillBadge,
  listAgencyShifts,
  listAgencyShiftsPage,
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
  type ShiftStatus,
  todayIsoDate,
} from "@/lib/domain/shifts";
import { RELATIONSHIP_STATUS_LABELS } from "@/lib/domain/vocabulary";

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
  const cursor = decodeCursor(first(raw.after));
  const [page, facilities, locations, disciplines] = await Promise.all([
    listAgencyShiftsPage(organisationId, filters, cursor),
    listFacilityFilterOptions(organisationId),
    canCreate ? listSchedulableLocations(organisationId) : Promise.resolve([]),
    canCreate ? listDisciplines() : Promise.resolve([]),
  ]);
  const shifts = page.items;
  const base = `/app/organisations/${organisationId}/shifts` as const;
  const nextQuery = new URLSearchParams(
    Object.entries({ ...filters, after: page.nextCursor ?? "" }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "",
    ),
  ).toString();
  // Quick filters over upcoming work (from today), counted from the existing list query.
  const today = todayIsoDate();
  const upcoming = await listAgencyShifts(organisationId, { from: today });
  const quick = (status: ShiftStatus) => ({
    count: upcoming.filter((shift) => shift.status === status).length,
    href: `${base}?status=${status}&from=${today}` as Route,
    active:
      filters.status === status && filters.from === today && !filters.to && !filters.facilityId,
  });
  const openQuick = quick("open");
  const submittedQuick = quick("submitted");
  const draftQuick = quick("draft");
  const notFullyStaffed = upcoming.filter(
    (shift) => shift.status === "open" && shift.fillState !== "filled",
  ).length;
  const hasFilters = Boolean(filters.status || filters.facilityId || filters.from || filters.to);

  return (
    <>
      <PageHeader
        title="Shifts"
        back={
          <Link
            href={`/app/organisations/${organisationId}`}
            className="text-primary underline underline-offset-4"
          >
            {organisation.name}
          </Link>
        }
        description={
          <p>
            Work requested by and scheduled for your client facilities. Times are shown in each
            facility location&apos;s own timezone.
          </p>
        }
        primaryAction={
          canCreate && locations.length > 0 ? (
            <a
              href="#create-shift-heading"
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              New shift
            </a>
          ) : undefined
        }
      />

      <KpiFilterGroup label="Upcoming shifts">
        <KpiFilterCard
          label="Open"
          value={openQuick.count}
          supporting={`${notFullyStaffed} not fully staffed`}
          icon={<WorkspaceNavIcon name="shifts" />}
          href={openQuick.href}
          active={openQuick.active}
        />
        <KpiFilterCard
          label="Facility requests"
          value={submittedQuick.count}
          supporting="Waiting to be opened"
          icon={<WorkspaceNavIcon name="requests" />}
          href={submittedQuick.href}
          active={submittedQuick.active}
        />
        <KpiFilterCard
          label="Drafts"
          value={draftQuick.count}
          supporting="Not yet open"
          icon={<WorkspaceNavIcon name="timesheets" />}
          href={draftQuick.href}
          active={draftQuick.active}
        />
      </KpiFilterGroup>

      <section aria-labelledby="shift-filters-heading" className="flex flex-col gap-3">
        <h2 id="shift-filters-heading" className="sr-only">
          Filter shifts
        </h2>
        <FilterBar
          key={JSON.stringify(filters)}
          label="Filter shifts"
          resetHref={hasFilters ? (base as Route) : undefined}
        >
          <FilterSelect
            label="Status"
            id="filter-status"
            name="status"
            defaultValue={filters.status ?? ""}
          >
            <option value="">All statuses</option>
            {SHIFT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {SHIFT_STATUS_LABELS[status]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Facility"
            id="filter-facility"
            name="facilityId"
            defaultValue={filters.facilityId ?? ""}
          >
            <option value="">All facilities</option>
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name}
              </option>
            ))}
          </FilterSelect>
          <FilterField label="From" htmlFor="filter-from">
            <Input id="filter-from" name="from" type="date" defaultValue={filters.from ?? ""} />
          </FilterField>
          <FilterField label="To" htmlFor="filter-to">
            <Input id="filter-to" name="to" type="date" defaultValue={filters.to ?? ""} />
          </FilterField>
        </FilterBar>
      </section>

      <section aria-labelledby="shift-list-heading" className="flex flex-col gap-3">
        <h2 id="shift-list-heading" className="text-lg font-semibold">
          Shift list
        </h2>
        {shifts.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No shifts match."
            description={
              hasFilters
                ? "Change or clear the filters to see more shifts."
                : "Shifts you create, and requests from facilities, appear here."
            }
          />
        ) : (
          <DataTableRegion aria-label="Shifts table">
            <DataTable className="min-w-[880px]">
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Shift</DataTableHeaderCell>
                  <DataTableHeaderCell>Date and time</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Staffing</DataTableHeaderCell>
                  <DataTableHeaderCell>Needs attention</DataTableHeaderCell>
                  <DataTableHeaderCell>
                    <span className="sr-only">Details</span>
                  </DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                {shifts.map((shift) => {
                  const href = `${base}/${shift.id}` as Route;
                  const title = `${shift.facilityName} · ${shift.disciplineName} · ${formatShiftDate(shift)}`;
                  const flags = (
                    <div className="flex flex-wrap gap-1">
                      {shift.source === "facility" ? (
                        <Badge tone="neutral">{SHIFT_SOURCE_LABELS.facility}</Badge>
                      ) : null}
                      {shift.relationshipStatus !== "active" ? (
                        <StatusChip tone="warning">Relationship not active</StatusChip>
                      ) : null}
                      {shift.openIssueCount > 0 ? (
                        <StatusChip tone="attention">
                          Needs attention ({shift.openIssueCount})
                        </StatusChip>
                      ) : null}
                    </div>
                  );
                  const fill =
                    shift.status === "open" ? (
                      <FillBadge
                        fillState={shift.fillState}
                        activeCount={shift.activeCount}
                        requestedHeadcount={shift.requestedHeadcount}
                      />
                    ) : (
                      <span className="text-muted-foreground">
                        {shift.requestedHeadcount} needed
                      </span>
                    );
                  return (
                    <DataTableRow key={shift.id}>
                      <DataTableCell>
                        <Link
                          href={href}
                          className="font-medium text-primary underline underline-offset-4"
                        >
                          {title}
                        </Link>
                        <div className="text-muted-foreground">
                          {shift.locationName}
                          {shift.externalReference ? ` · Ref ${shift.externalReference}` : ""}
                        </div>
                      </DataTableCell>
                      <DataTableCell>{formatShiftTimeRange(shift)}</DataTableCell>
                      <DataTableCell>
                        <ShiftStatusBadge status={shift.status} />
                      </DataTableCell>
                      <DataTableCell>{fill}</DataTableCell>
                      <DataTableCell>{flags}</DataTableCell>
                      <DataTableCell>
                        <DetailDrawerTrigger
                          triggerLabel="Details"
                          triggerAccessibleLabel={`Details for ${title}`}
                          title={`${shift.facilityName} · ${shift.disciplineName}`}
                          description={`${formatShiftDate(shift)} · ${formatShiftTimeRange(shift)}`}
                          footer={
                            <Link
                              href={href}
                              className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
                            >
                              Open shift
                            </Link>
                          }
                        >
                          <KeyValueList
                            items={[
                              {
                                label: "Status",
                                value: <ShiftStatusBadge status={shift.status} />,
                              },
                              { label: "Staffing", value: fill },
                              {
                                label: "Assigned",
                                value: `${shift.activeCount} of ${shift.requestedHeadcount} (${shift.acceptedCount} accepted)`,
                              },
                              { label: "Facility", value: shift.facilityName },
                              { label: "Location", value: shift.locationName },
                              { label: "Discipline", value: shift.disciplineName },
                              { label: "Timezone", value: shift.timezone },
                              { label: "Source", value: SHIFT_SOURCE_LABELS[shift.source] },
                              {
                                label: "Relationship",
                                value: RELATIONSHIP_STATUS_LABELS[shift.relationshipStatus],
                              },
                              ...(shift.externalReference
                                ? [{ label: "Reference", value: shift.externalReference }]
                                : []),
                              {
                                label: "Needs attention",
                                value:
                                  shift.openIssueCount > 0
                                    ? `${shift.openIssueCount} open issue(s)`
                                    : "Nothing open",
                              },
                            ]}
                          />
                        </DetailDrawerTrigger>
                      </DataTableCell>
                    </DataTableRow>
                  );
                })}
              </tbody>
            </DataTable>
          </DataTableRegion>
        )}
        <DataTablePagination
          label="Shift list pages"
          previousHref={cursor ? (base as Route) : null}
          previousLabel="First page"
          nextHref={page.nextCursor ? (`${base}?${nextQuery}` as Route) : null}
        />
      </section>

      {canCreate ? (
        <section aria-labelledby="create-shift-heading" className="flex flex-col gap-3">
          <h2 id="create-shift-heading" className="scroll-mt-24 text-lg font-semibold">
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
