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
import { FilterBar, FilterSelect } from "@/components/ui/filter-bar";
import { KeyValueList } from "@/components/ui/key-value-list";
import { KpiFilterCard, KpiFilterGroup } from "@/components/ui/kpi-filter-card";
import { PageHeader } from "@/components/ui/page-header";
import { listDisciplines } from "@/features/credentials";
import { listPartnerRelationships } from "@/features/facilities";
import { loadOrganisationPage, requireCapabilityOrNotFound } from "@/features/organisations";
import {
  decodeCursor,
  FacilityRequestForm,
  FillBadge,
  listFacilityShifts,
  listFacilityShiftsPage,
  listRequestLocations,
  ShiftStatusBadge,
} from "@/features/shifts";
import { CAPABILITIES } from "@/lib/authz";
import {
  formatShiftDate,
  formatShiftTimeRange,
  hasEnded,
  SHIFT_CANCELLATION_REASON_LABELS,
  SHIFT_SOURCE_LABELS,
  SHIFT_STATUS_LABELS,
  SHIFT_STATUSES,
  todayIsoDate,
} from "@/lib/domain/shifts";
import { RELATIONSHIP_STATUS_LABELS } from "@/lib/domain/vocabulary";

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
  const raw = await searchParams;
  const after = raw.after;
  const pick = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value || undefined;
  const statusFilter = SHIFT_STATUSES.find((status) => status === pick(raw.status));
  const upcomingOnly = pick(raw.when) === "upcoming";
  const cursor = decodeCursor(typeof after === "string" ? after : undefined);
  const [page, allShifts, relationships, disciplines] = await Promise.all([
    listFacilityShiftsPage(organisationId, cursor),
    // Real counts from the same facility projection (not audited per worker).
    listFacilityShifts(organisationId),
    canRequest && can(CAPABILITIES.RELATIONSHIP_VIEW) === "granted"
      ? listPartnerRelationships(organisationId)
      : Promise.resolve([]),
    canRequest ? listDisciplines() : Promise.resolve([]),
  ]);
  // Display filter over the facility projection already loaded for the counts;
  // unfiltered, the list keeps its cursor pagination.
  const filtered = Boolean(statusFilter || upcomingOnly);
  const shifts = filtered
    ? allShifts.filter(
        (shift) =>
          (!statusFilter || shift.status === statusFilter) && (!upcomingOnly || !hasEnded(shift)),
      )
    : page.items;
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

  const base = `/app/organisations/${organisationId}/staffing-requests` as const;
  const upcoming = allShifts.filter((shift) => !hasEnded(shift));
  const awaitingAgency = upcoming.filter((shift) => shift.status === "submitted").length;
  const openUpcoming = upcoming.filter((shift) => shift.status === "open");
  const notFullyStaffed = openUpcoming.filter((shift) => shift.fillState !== "filled").length;
  const confirmedWorkers = openUpcoming.reduce((sum, shift) => sum + shift.acceptedCount, 0);
  const quickHref = (status: string) => `${base}?status=${status}&when=upcoming` as Route;

  return (
    <>
      <PageHeader
        title="Staffing requests"
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
            Request staff from your partner agencies and follow how each request is being filled.
          </p>
        }
        primaryAction={
          canRequest && options.length > 0 ? (
            <a
              href="#new-request-heading"
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              New request
            </a>
          ) : undefined
        }
      />

      <KpiFilterGroup label="Upcoming requests">
        <KpiFilterCard
          label="Awaiting agency"
          value={awaitingAgency}
          supporting="Requested, not yet opened"
          icon={<WorkspaceNavIcon name="requests" />}
          href={quickHref("submitted")}
          active={statusFilter === "submitted" && upcomingOnly}
        />
        <KpiFilterCard
          label="Open"
          value={openUpcoming.length}
          supporting={`${notFullyStaffed} not fully staffed`}
          icon={<WorkspaceNavIcon name="shifts" />}
          href={quickHref("open")}
          active={statusFilter === "open" && upcomingOnly}
        />
        <KpiFilterCard
          label="Workers confirmed"
          value={confirmedWorkers}
          supporting="Accepted on upcoming open shifts"
          icon={<WorkspaceNavIcon name="workforce" />}
        />
      </KpiFilterGroup>

      <section aria-labelledby="requests-heading" className="flex flex-col gap-3">
        <h2 id="requests-heading" className="text-lg font-semibold">
          Requests and shifts
        </h2>
        <FilterBar
          key={`${statusFilter ?? ""}_${upcomingOnly}`}
          label="Filter requests"
          resetHref={filtered ? (base as Route) : undefined}
        >
          <FilterSelect
            label="Status"
            id="request-status"
            name="status"
            defaultValue={statusFilter ?? ""}
          >
            <option value="">All statuses</option>
            {SHIFT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {SHIFT_STATUS_LABELS[status]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="When"
            id="request-when"
            name="when"
            defaultValue={upcomingOnly ? "upcoming" : ""}
          >
            <option value="">Any time</option>
            <option value="upcoming">Upcoming</option>
          </FilterSelect>
        </FilterBar>
        {shifts.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title={filtered ? "No requests match." : "No requests yet."}
            description={
              canRequest
                ? "Requests you submit, and shifts your agencies schedule here, appear in this list."
                : "Shifts your agencies schedule at this facility appear in this list."
            }
          />
        ) : (
          <DataTableRegion aria-label="Staffing requests table">
            <DataTable className="min-w-[820px]">
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Request</DataTableHeaderCell>
                  <DataTableHeaderCell>Location and time</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Staffing</DataTableHeaderCell>
                  <DataTableHeaderCell>Source</DataTableHeaderCell>
                  <DataTableHeaderCell>
                    <span className="sr-only">Details</span>
                  </DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                {shifts.map((shift) => {
                  const href = `${base}/${shift.id}` as Route;
                  const title = `${shift.agencyName} · ${shift.disciplineName} · ${formatShiftDate(shift)}`;
                  const staffing =
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
                      </DataTableCell>
                      <DataTableCell>
                        {shift.locationName}
                        <div className="text-muted-foreground">{formatShiftTimeRange(shift)}</div>
                      </DataTableCell>
                      <DataTableCell>
                        <ShiftStatusBadge status={shift.status} />
                      </DataTableCell>
                      <DataTableCell>{staffing}</DataTableCell>
                      <DataTableCell>
                        <Badge tone="neutral">{SHIFT_SOURCE_LABELS[shift.source]}</Badge>
                      </DataTableCell>
                      <DataTableCell>
                        <DetailDrawerTrigger
                          triggerLabel="Details"
                          triggerAccessibleLabel={`Details for ${title}`}
                          title={`${shift.disciplineName} · ${formatShiftDate(shift)}`}
                          description={`${shift.agencyName} · ${shift.locationName}`}
                          footer={
                            <Link
                              href={href}
                              className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
                            >
                              Open request
                            </Link>
                          }
                        >
                          <KeyValueList
                            items={[
                              {
                                label: "Status",
                                value: <ShiftStatusBadge status={shift.status} />,
                              },
                              { label: "Staffing", value: staffing },
                              {
                                label: "Workers needed",
                                value: `${shift.requestedHeadcount} (${shift.acceptedCount} confirmed)`,
                              },
                              { label: "Agency", value: shift.agencyName },
                              { label: "Location", value: shift.locationName },
                              { label: "Time", value: formatShiftTimeRange(shift) },
                              { label: "Timezone", value: shift.timezone },
                              { label: "Source", value: SHIFT_SOURCE_LABELS[shift.source] },
                              {
                                label: "Agency relationship",
                                value: RELATIONSHIP_STATUS_LABELS[shift.relationshipStatus],
                              },
                              ...(shift.externalReference
                                ? [{ label: "Reference", value: shift.externalReference }]
                                : []),
                              ...(shift.cancellationReason
                                ? [
                                    {
                                      label: "Cancelled",
                                      value:
                                        SHIFT_CANCELLATION_REASON_LABELS[shift.cancellationReason],
                                    },
                                  ]
                                : []),
                            ]}
                          />
                          <p className="text-sm text-muted-foreground">
                            Who is coming and attendance are on the request page.
                          </p>
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
          label="Request list pages"
          nextHref={
            !filtered && page.nextCursor ? (`${base}?after=${page.nextCursor}` as Route) : null
          }
          nextLabel="Older requests"
        />
      </section>

      {canRequest ? (
        <section aria-labelledby="new-request-heading" className="flex flex-col gap-3">
          <h2 id="new-request-heading" className="scroll-mt-24 text-lg font-semibold">
            Request staff
          </h2>
          {options.length === 0 ? (
            <EmptyState
              headingLevel={3}
              title="Requests are not available yet."
              description="You need an active relationship with an agency, and the agency must have set up your locations, before you can request staff."
            />
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
