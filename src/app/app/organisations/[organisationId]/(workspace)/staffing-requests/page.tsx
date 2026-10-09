import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import {
  REF_CARD_FROSTED,
  REF_TABLE,
  REF_TEXT,
  RefChip,
  RefKpiCard,
  RefPanel,
} from "@/components/reference/locked-reference";
import { DataTablePagination, DataTableRegion } from "@/components/ui/data-table";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { listDisciplines } from "@/features/credentials";
import { listPartnerRelationships } from "@/features/facilities";
import { loadOrganisationPage, requireCapabilityOrNotFound } from "@/features/organisations";
import {
  decodeCursor,
  FacilityRequestForm,
  FILL_TONE,
  listFacilityShifts,
  listFacilityShiftsPage,
  listRequestLocations,
  SHIFT_TONE,
} from "@/features/shifts";
import { CAPABILITIES } from "@/lib/authz";
import {
  FILL_STATE_LABELS,
  formatShiftDate,
  formatShiftTimeRange,
  hasEnded,
  SHIFT_SOURCE_LABELS,
  SHIFT_STATUS_LABELS,
  SHIFT_STATUSES,
  todayIsoDate,
} from "@/lib/domain/shifts";
import { cn } from "@/lib/utils/cn";

import { HeaderAddAction, LockedFilterSelect } from "../(finance)/_components/finance-locked";
import { RequestDetailsPanel } from "./_components/request-details-panel";

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
    // Locked facility list (P0-E8-QA-F1): the Facilities / Timesheets page family.
    <div className="chelth-locked flex flex-col gap-[13px]">
      <PageHeader
        variant="reference"
        className="xl:mb-1"
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
            <HeaderAddAction href="#request-staff">New request</HeaderAddAction>
          ) : undefined
        }
      />

      {/* Locked: with Request Details open on wide screens the work area contracts beside it. */}
      <div className="flex flex-col gap-[13px] min-[1536px]:has-[dialog[open]]:pr-[407px]">
        <section
          aria-label="Upcoming requests"
          className="grid grid-cols-2 gap-3 xl:grid-cols-3 xl:gap-[13px]"
        >
          <RefKpiCard
            size="sm"
            label="Awaiting Agency"
            value={awaitingAgency}
            supporting="Requested, not yet opened"
            glyph="document"
            icon={<WorkspaceNavIcon name="requests" strokeWidth={2.4} duotone />}
            tone="info"
            href={quickHref("submitted")}
            active={statusFilter === "submitted" && upcomingOnly}
          />
          <RefKpiCard
            size="sm"
            label="Open"
            value={openUpcoming.length}
            supporting={`${notFullyStaffed} not fully staffed`}
            glyph="calendar"
            icon={<WorkspaceNavIcon name="shifts" strokeWidth={2.4} duotone />}
            tone={notFullyStaffed > 0 ? "warning" : "teal"}
            href={quickHref("open")}
            active={statusFilter === "open" && upcomingOnly}
          />
          <RefKpiCard
            size="sm"
            label="Workers Confirmed"
            value={confirmedWorkers}
            supporting="Accepted on upcoming open shifts"
            glyph="people"
            icon={<WorkspaceNavIcon name="workforce" strokeWidth={2.4} duotone />}
            tone="teal"
          />
        </section>

        {/* Locked filter row: the same URL-backed display filters as before. */}
        <form
          key={`${statusFilter ?? ""}_${upcomingOnly}`}
          aria-label="Filter requests"
          method="get"
          className="flex flex-wrap items-center gap-[9px]"
        >
          <LockedFilterSelect
            id="request-status"
            name="status"
            label="Status"
            value={statusFilter ?? ""}
            className="xl:w-[196px]"
            icon={<WorkspaceNavIcon name="requests" />}
          >
            <option value="">All statuses</option>
            {SHIFT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {SHIFT_STATUS_LABELS[status]}
              </option>
            ))}
          </LockedFilterSelect>
          <LockedFilterSelect
            id="request-when"
            name="when"
            label="When"
            value={upcomingOnly ? "upcoming" : ""}
            className="xl:w-[176px]"
            icon={<WorkspaceNavIcon name="shifts" />}
          >
            <option value="">Any time</option>
            <option value="upcoming">Upcoming</option>
          </LockedFilterSelect>
          <button
            type="submit"
            className="inline-flex h-11 items-center rounded-md border border-chelth-border bg-white/90 px-4 text-[13.5px] font-medium text-chelth-navy hover:bg-surface-muted sm:h-[46px]"
          >
            Apply filters
          </button>
          {filtered ? (
            <Link
              href={base as Route}
              className="inline-flex min-h-11 items-center px-1 text-[13px] font-medium text-primary underline underline-offset-4"
            >
              Clear filters
            </Link>
          ) : null}
        </form>

        <RefPanel
          title="Requests and Shifts"
          titleId="requests-heading"
          action={
            <span className="text-[13.5px] text-muted-foreground">
              {shifts.length === 1 ? "1 request" : `${shifts.length} requests`}
            </span>
          }
        >
          {shifts.length === 0 ? (
            <div className="mt-[9px]">
              <EmptyState
                headingLevel={3}
                title={filtered ? "No requests match." : "No requests yet."}
                description={
                  canRequest
                    ? "Requests you submit, and shifts your agencies schedule here, appear in this list."
                    : "Shifts your agencies schedule at this facility appear in this list."
                }
              />
            </div>
          ) : (
            <DataTableRegion
              aria-label="Staffing requests table"
              className="mt-[9px] rounded-none border-0 bg-transparent"
            >
              <table className={cn(REF_TABLE, "min-w-[860px] table-fixed")}>
                <colgroup>
                  <col className="w-[25%]" />
                  <col className="w-[20%]" />
                  <col className="w-[17%]" />
                  <col className="w-[10%]" />
                  <col className="w-[13%]" />
                  <col className="w-[10%]" />
                  <col className="w-[5%]" />
                </colgroup>
                <thead className={REF_TEXT.tableHead}>
                  <tr>
                    <th scope="col">Request</th>
                    <th scope="col">Agency and Location</th>
                    <th scope="col">Time</th>
                    <th scope="col">Status</th>
                    <th scope="col">Staffing</th>
                    <th scope="col">Source</th>
                    <th scope="col">
                      <span className="sr-only">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody className={REF_TEXT.tableBody}>
                  {shifts.map((shift) => {
                    const href = `${base}/${shift.id}` as Route;
                    const title = `${shift.agencyName} · ${shift.disciplineName} · ${formatShiftDate(shift)}`;
                    return (
                      <tr
                        key={shift.id}
                        className="h-[42px] transition-colors hover:bg-surface-muted/50 has-[dialog[open]]:bg-chelth-mint-mist/70 [&:has(dialog[open])>*:first-child]:shadow-[inset_3px_0_0_var(--chelth-teal)]"
                      >
                        <td>
                          <span className="flex flex-col py-2">
                            <Link
                              href={href}
                              className="font-medium text-chelth-navy hover:text-primary hover:underline hover:underline-offset-4"
                            >
                              {shift.disciplineName}
                            </Link>
                            <span className="text-muted-foreground">{formatShiftDate(shift)}</span>
                          </span>
                        </td>
                        <td>
                          <span className="flex flex-col py-2">
                            <span className="truncate">{shift.agencyName}</span>
                            <span className="truncate text-muted-foreground">
                              {shift.locationName}
                            </span>
                          </span>
                        </td>
                        <td>{formatShiftTimeRange(shift)}</td>
                        <td>
                          <RefChip tone={SHIFT_TONE[shift.status]} className="font-normal">
                            {SHIFT_STATUS_LABELS[shift.status]}
                          </RefChip>
                        </td>
                        <td>
                          {shift.status === "open" ? (
                            <RefChip tone={FILL_TONE[shift.fillState]} className="font-normal">
                              {FILL_STATE_LABELS[shift.fillState]} · {shift.activeCount} of{" "}
                              {shift.requestedHeadcount}
                            </RefChip>
                          ) : (
                            <span className="text-muted-foreground">
                              {shift.requestedHeadcount} needed
                            </span>
                          )}
                        </td>
                        <td>
                          <RefChip tone="neutral" className="font-normal">
                            {SHIFT_SOURCE_LABELS[shift.source]}
                          </RefChip>
                        </td>
                        <td className="text-right">
                          <DetailDrawerTrigger
                            triggerLabel="⋮"
                            triggerClassName="justify-center px-2 text-xl font-bold text-chelth-navy no-underline sm:min-h-9"
                            triggerAccessibleLabel={`Details for ${title}`}
                            title="Request Details"
                            width="profile"
                          >
                            <RequestDetailsPanel shift={shift} href={href} />
                          </DetailDrawerTrigger>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DataTableRegion>
          )}
        </RefPanel>
        <DataTablePagination
          label="Request list pages"
          nextHref={
            !filtered && page.nextCursor ? (`${base}?after=${page.nextCursor}` as Route) : null
          }
          nextLabel="Older requests"
        />

        {canRequest ? (
          <section
            id="request-staff"
            aria-labelledby="new-request-heading"
            className={cn(REF_CARD_FROSTED, "flex scroll-mt-24 flex-col gap-4 p-4 sm:p-5")}
          >
            <h2 id="new-request-heading" className={REF_TEXT.panelTitle}>
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
      </div>
    </div>
  );
}
