import type { Metadata, Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { REF_CARD_FROSTED, RefChip, RefKpiCard } from "@/components/reference/locked-reference";
import { DataTableRegion } from "@/components/ui/data-table";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  FACILITY_TONE,
  FacilityForm,
  getFacility,
  listFacilities,
  listFacilityTypes,
  listLocations,
  listRelationships,
  listTimezones,
  RELATIONSHIP_TONE,
} from "@/features/facilities";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { type AgencyShiftSummary, listAgencyShifts } from "@/features/shifts";
import { CAPABILITIES } from "@/lib/authz";
import { disciplineNameParts, startsWithin, todayIsoDate } from "@/lib/domain/shifts";
import {
  FACILITY_STATUS_LABELS,
  FACILITY_STATUSES,
  RELATIONSHIP_STATUS_LABELS,
  RELATIONSHIP_STATUSES,
} from "@/lib/domain/vocabulary";
import { cn } from "@/lib/utils/cn";

import { FacilityDetailsPanel } from "./_components/facility-details-panel";

export const metadata: Metadata = { title: "Facilities" };

/** Locked Facilities reference: ten facilities per page. */
const PAGE_SIZE = 10;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

/** A facility request still waiting for staff: requested, or open and not filled. */
function isOpenRequest(shift: AgencyShiftSummary): boolean {
  return (
    shift.source === "facility" &&
    (shift.status === "submitted" || (shift.status === "open" && shift.fillState !== "filled"))
  );
}

export default async function FacilitiesPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/facilities">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.FACILITY_VIEW);
  const { organisationId, can } = context;
  const canManage = can(CAPABILITIES.FACILITY_MANAGE);
  const canViewFacilities = can(CAPABILITIES.FACILITY_VIEW) === "granted";
  const canViewRelationship = can(CAPABILITIES.RELATIONSHIP_VIEW) === "granted";
  const canViewShifts = can(CAPABILITIES.SHIFT_VIEW) !== "not_held";

  const raw = await searchParams;
  const statusFilter = FACILITY_STATUSES.find((status) => status === first(raw.status));
  const relationshipFilter = RELATIONSHIP_STATUSES.find(
    (status) => status === first(raw.relationship),
  );
  const attentionFilter = first(raw.attention) === "1";
  const requestsFilter = first(raw.requests) === "1";
  const typeFilter = first(raw.type);
  const search = (first(raw.q) ?? "").trim().slice(0, 80);
  const requestedPage = Number.parseInt(first(raw.page) ?? "1", 10);

  const today = todayIsoDate();
  const [facilities, facilityTypes, upcoming] = await Promise.all([
    canViewFacilities ? listFacilities(organisationId) : Promise.resolve([]),
    listFacilityTypes(),
    canViewShifts ? listAgencyShifts(organisationId, { from: today }) : Promise.resolve([]),
  ]);
  const typeName = new Map(facilityTypes.map((type) => [type.key, type.name]));
  // The facility record's own loaders, under the same capabilities.
  const [details, locationEntries, relationshipEntries] = await Promise.all([
    Promise.all(facilities.map((facility) => getFacility(organisationId, facility.id))),
    Promise.all(
      facilities.map(async (facility) => [facility.id, await listLocations(facility.id)] as const),
    ),
    canViewRelationship
      ? Promise.all(
          facilities.map(
            async (facility) => [facility.id, await listRelationships(facility.id)] as const,
          ),
        )
      : Promise.resolve([]),
  ]);
  const detailOf = new Map(
    details.flatMap((detail) => (detail ? [[detail.id, detail] as const] : [])),
  );
  const locationsOf = new Map(locationEntries);
  // The current relationship: the open one, else the latest.
  const relationshipOf = new Map(
    relationshipEntries.map(([facilityId, list]) => [
      facilityId,
      list.find((relationship) => relationship.status !== "ended") ?? list[0] ?? null,
    ]),
  );
  const shiftsOf = (facilityId: string) =>
    upcoming.filter((shift) => shift.facilityId === facilityId);
  const openRequestsOf = (facilityId: string) => shiftsOf(facilityId).filter(isOpenRequest);
  // Follow-up needed: an active facility whose relationship is not active, or that has no
  // active location to schedule at.
  const needsAttention = (facilityId: string) => {
    const facility = facilities.find((entry) => entry.id === facilityId);
    if (!facility || facility.status !== "active") return false;
    const relationship = relationshipOf.get(facilityId);
    const relationshipIssue = canViewRelationship && relationship?.status !== "active";
    const locationIssue = !(locationsOf.get(facilityId) ?? []).some(
      (location) => location.status === "active",
    );
    return relationshipIssue || locationIssue;
  };

  const typeOptions = facilityTypes.filter((type) =>
    facilities.some((facility) => facility.facilityTypeKey === type.key),
  );
  const selectedType = typeOptions.find((type) => type.key === typeFilter)?.key;
  const needle = search.toLowerCase();
  const shown = facilities.filter((facility) => {
    if (statusFilter && facility.status !== statusFilter) return false;
    if (selectedType && facility.facilityTypeKey !== selectedType) return false;
    if (relationshipFilter && relationshipOf.get(facility.id)?.status !== relationshipFilter) {
      return false;
    }
    if (attentionFilter && !needsAttention(facility.id)) return false;
    if (requestsFilter && openRequestsOf(facility.id).length === 0) return false;
    if (
      needle &&
      !facility.name.toLowerCase().includes(needle) &&
      !(facility.locality ?? "").toLowerCase().includes(needle)
    ) {
      return false;
    }
    return true;
  });
  const hasFilters = Boolean(
    statusFilter ||
    selectedType ||
    relationshipFilter ||
    attentionFilter ||
    requestsFilter ||
    search,
  );
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const pageNumber = Math.min(
    Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1),
    pageCount,
  );
  const pageRows = shown.slice((pageNumber - 1) * PAGE_SIZE, pageNumber * PAGE_SIZE);

  const activeCount = facilities.filter((facility) => facility.status === "active").length;
  const openRequestCount = upcoming.filter(isOpenRequest).length;
  const shiftsThisWeek = upcoming.filter((shift) => startsWithin(shift, 24 * 7)).length;
  const attentionCount = facilities.filter((facility) => needsAttention(facility.id)).length;

  const orgBase = `/app/organisations/${organisationId}` as const;
  const base = `${orgBase}/facilities` as const;
  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (statusFilter) query.set("status", statusFilter);
    if (selectedType) query.set("type", selectedType);
    if (relationshipFilter) query.set("relationship", relationshipFilter);
    if (attentionFilter) query.set("attention", "1");
    if (requestsFilter) query.set("requests", "1");
    if (search) query.set("q", search);
    if (target > 1) query.set("page", String(target));
    const text = query.toString();
    return (text ? `${base}?${text}` : base) as Route;
  };
  const firstShown = shown.length === 0 ? 0 : (pageNumber - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(pageNumber * PAGE_SIZE, shown.length);

  return (
    <div className="chelth-locked flex flex-col gap-5">
      <PageHeader
        variant="reference"
        title="Facilities"
        description={
          <p>Manage facility relationships, staffing demand and locations in one place.</p>
        }
        primaryAction={
          canManage === "granted" ? (
            <a
              href="#add-facility"
              className="inline-flex h-11 items-center gap-2.5 rounded-[7px] bg-chelth-teal-dark px-5 text-[15px] font-medium text-white shadow-[0_2px_6px_rgba(0,58,64,0.25)] hover:bg-chelth-teal sm:h-[47px] sm:min-w-[158px] sm:justify-center"
            >
              <span aria-hidden="true" className="text-xl leading-none font-light">
                +
              </span>
              Add Facility
            </a>
          ) : undefined
        }
      />

      {canManage === "granted" ? (
        // The existing create flow, revealed by "Add Facility" (CSS :target, same action).
        <section
          id="add-facility"
          aria-labelledby="create-facility-heading"
          className={cn(REF_CARD_FROSTED, "hidden scroll-mt-24 flex-col gap-3 p-4 target:flex")}
        >
          <div className="flex items-start justify-between gap-3">
            <h2
              id="create-facility-heading"
              className="font-display text-[18px] leading-6 font-semibold text-chelth-navy"
            >
              Add a client facility
            </h2>
            <a
              href="#facilities-heading"
              className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-primary underline underline-offset-4 hover:bg-surface-muted sm:min-h-9"
            >
              Close
            </a>
          </div>
          <FacilityForm
            organisationId={organisationId}
            facilityTypes={facilityTypes}
            timezones={listTimezones()}
          />
        </section>
      ) : canManage === "step_up_required" ? (
        <StepUpNotice returnTo={base}>
          Adding or editing facilities requires verification with your authenticator app.
        </StepUpNotice>
      ) : null}

      {/* Locked: with Facility Details open on wide screens the work area contracts beside it. */}
      <div className="flex flex-col gap-5 min-[1536px]:has-[dialog[open]]:pr-[407px]">
        {facilities.length > 0 ? (
          <section
            aria-label="Facilities summary"
            className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-[9px]"
          >
            <RefKpiCard
              size="sm"
              label="Active Facilities"
              value={activeCount}
              supporting={`of ${facilities.length} facilities`}
              glyph="building"
              icon={<WorkspaceNavIcon name="facilities" strokeWidth={2.4} duotone />}
              tone="teal"
              href={`${base}?status=active` as Route}
              active={statusFilter === "active" && !hasOtherThan("status")}
            />
            {canViewShifts ? (
              <>
                <RefKpiCard
                  size="sm"
                  label="Open Requests"
                  value={openRequestCount}
                  supporting="Facility requests needing staff"
                  glyph="document"
                  icon={<WorkspaceNavIcon name="requests" strokeWidth={2.4} duotone />}
                  tone="danger"
                  href={`${base}?requests=1` as Route}
                  active={requestsFilter}
                />
                <RefKpiCard
                  size="sm"
                  label="Shifts This Week"
                  value={shiftsThisWeek}
                  supporting="Across all facilities"
                  glyph="calendar"
                  icon={<WorkspaceNavIcon name="shifts" strokeWidth={2.4} duotone />}
                  tone="info"
                  href={`${orgBase}/shifts?from=${today}` as Route}
                />
              </>
            ) : null}
            <RefKpiCard
              size="sm"
              label="Needs Attention"
              value={attentionCount}
              supporting="Relationship or locations"
              glyph="alert"
              icon={<WorkspaceNavIcon name="compliance" strokeWidth={2.4} duotone />}
              tone="danger"
              href={`${base}?attention=1` as Route}
              active={attentionFilter}
            />
          </section>
        ) : null}

        {facilities.length > 0 ? (
          // Locked filter row: real display filters over the loaded facilities.
          <form
            key={JSON.stringify([statusFilter, selectedType, relationshipFilter, search])}
            aria-label="Filter facilities"
            method="get"
            className="flex flex-wrap items-center gap-[9px]"
          >
            <FilterSelect
              id="facility-status"
              name="status"
              label="Status"
              value={statusFilter ?? ""}
              className="xl:w-[176px]"
              icon={<WorkspaceNavIcon name="facilities" />}
            >
              <option value="">All statuses</option>
              {FACILITY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {FACILITY_STATUS_LABELS[status]}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              id="facility-type"
              name="type"
              label="Facility type"
              value={selectedType ?? ""}
              className="xl:w-[196px]"
            >
              <option value="">All facility types</option>
              {typeOptions.map((type) => (
                <option key={type.key} value={type.key}>
                  {type.name}
                </option>
              ))}
            </FilterSelect>
            {canViewRelationship ? (
              <FilterSelect
                id="facility-relationship"
                name="relationship"
                label="Relationship"
                value={relationshipFilter ?? ""}
                className="xl:w-[196px]"
              >
                <option value="">All relationships</option>
                {RELATIONSHIP_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {RELATIONSHIP_STATUS_LABELS[status]}
                  </option>
                ))}
              </FilterSelect>
            ) : null}
            <span className="flex h-[46px] min-w-48 flex-1 items-center gap-2.5 rounded-md border border-chelth-border bg-white/90 px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring xl:max-w-[280px]">
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
                className="size-[18px] shrink-0 text-chelth-navy"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <Label htmlFor="facility-search" className="sr-only">
                Search facilities
              </Label>
              <input
                id="facility-search"
                name="q"
                type="search"
                defaultValue={search}
                placeholder="Search facilities…"
                className="h-full min-w-0 flex-1 bg-transparent text-base text-chelth-navy outline-none placeholder:text-muted-foreground sm:text-[13.5px]"
              />
            </span>
            <button
              type="submit"
              className="inline-flex h-11 items-center rounded-md border border-chelth-border bg-white/90 px-4 text-[13.5px] font-medium text-chelth-navy hover:bg-surface-muted sm:h-[46px]"
            >
              Apply filters
            </button>
            {hasFilters ? (
              <Link
                href={base as Route}
                className="inline-flex min-h-11 items-center px-1 text-[13px] font-medium text-primary underline underline-offset-4"
              >
                Clear filters
              </Link>
            ) : null}
          </form>
        ) : null}

        <section aria-labelledby="facilities-heading" className="flex flex-col gap-3">
          <h2 id="facilities-heading" className="sr-only">
            Client facilities
          </h2>
          {facilities.length === 0 ? (
            <EmptyState
              headingLevel={3}
              title="No client facilities yet."
              description="Add the facilities you staff, then their locations and relationship."
            />
          ) : shown.length === 0 ? (
            <EmptyState
              headingLevel={3}
              title={
                statusFilter && !hasOtherThan("status")
                  ? "No facilities with this status."
                  : "No facilities match these filters."
              }
              action={
                <Link
                  href={base}
                  className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4"
                >
                  Show all facilities
                </Link>
              }
            />
          ) : (
            <div className={cn(REF_CARD_FROSTED, "overflow-hidden")}>
              <DataTableRegion
                aria-label="Client facilities table"
                className="rounded-none border-0 bg-transparent"
              >
                <table className="w-full min-w-[1008px] table-fixed border-separate border-spacing-0 text-left">
                  <colgroup>
                    <col className="w-[22%]" />
                    <col className="w-[12%]" />
                    <col className="w-[15%]" />
                    <col className="w-[8%]" />
                    <col className="w-[8%]" />
                    <col className="w-[11%]" />
                    <col className="w-[10%]" />
                    <col className="w-[10%]" />
                    <col className="w-[4%]" />
                  </colgroup>
                  <thead className="text-[12.5px] leading-4 font-semibold text-chelth-navy [&_th]:h-[47px] [&_th]:border-b [&_th]:border-chelth-border/55 [&_th]:bg-[color-mix(in_srgb,var(--chelth-mint-mist)_45%,#eef4f8)] [&_th]:px-3 [&_th]:font-semibold">
                    <tr>
                      <th scope="col" className="pl-4">
                        Facility
                      </th>
                      <th scope="col">Location</th>
                      <th scope="col">Contact</th>
                      <th scope="col">
                        Open
                        <br />
                        Requests
                      </th>
                      <th scope="col">
                        Upcoming
                        <br />
                        Shifts
                      </th>
                      <th scope="col">Roles Used</th>
                      <th scope="col">Status</th>
                      <th scope="col">Relationship</th>
                      <th scope="col">
                        <span className="sr-only">Details</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-[13.5px] leading-[18px] text-slate-600 [&_td]:h-[62px] [&_td]:border-b [&_td]:border-chelth-border/45 [&_td]:px-3 [&_th]:border-b [&_th]:border-chelth-border/45 [&_tr:last-child>*]:border-b-0">
                    {pageRows.map((facility) => {
                      const href = `${base}/${facility.id}` as Route;
                      const type =
                        typeName.get(facility.facilityTypeKey) ?? facility.facilityTypeKey;
                      const detail = detailOf.get(facility.id);
                      const locations = locationsOf.get(facility.id) ?? [];
                      const shifts = shiftsOf(facility.id);
                      const requests = shifts.filter((shift) => shift.source === "facility");
                      const openRequests = openRequestsOf(facility.id).length;
                      const roles = [
                        ...new Set(
                          shifts.map(
                            (shift) =>
                              disciplineNameParts(shift.disciplineName).code ??
                              shift.disciplineName,
                          ),
                        ),
                      ];
                      const relationship = relationshipOf.get(facility.id) ?? null;
                      const attention = needsAttention(facility.id);
                      return (
                        <tr
                          key={facility.id}
                          className="transition-colors hover:bg-surface-muted/50 has-[dialog[open]]:bg-chelth-mint-mist/70 [&:has(dialog[open])>*:first-child]:shadow-[inset_3px_0_0_var(--chelth-teal)]"
                        >
                          <th scope="row" className="h-[62px] pl-4 font-normal">
                            <span className="flex items-center gap-3">
                              <span
                                aria-hidden="true"
                                className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-[10px] bg-[linear-gradient(145deg,#e6f9f3,#ccefe3)] text-chelth-teal-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] [&>svg]:size-5"
                              >
                                <WorkspaceNavIcon name="facilities" strokeWidth={2.1} />
                              </span>
                              <span className="flex min-w-0 flex-col">
                                <Link
                                  href={href}
                                  className="truncate text-[14px] leading-5 font-semibold text-chelth-navy hover:text-primary hover:underline hover:underline-offset-4"
                                >
                                  {facility.name}
                                </Link>
                                <span className="truncate text-[12px] leading-4 text-muted-foreground">
                                  {type}
                                </span>
                              </span>
                            </span>
                          </th>
                          <td>
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate">{facility.locality ?? "—"}</span>
                              <span className="truncate text-[12px] text-muted-foreground">
                                {locations.length}{" "}
                                {locations.length === 1 ? "location" : "locations"}
                              </span>
                            </span>
                          </td>
                          <td>
                            {detail?.phone || detail?.email ? (
                              <span className="flex min-w-0 flex-col">
                                <span className="truncate">{detail.phone ?? detail.email}</span>
                                {detail.phone && detail.email ? (
                                  <span className="truncate text-[12px] text-muted-foreground">
                                    {detail.email}
                                  </span>
                                ) : null}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            {canViewShifts ? (
                              <CountPill tone={openRequests > 0 ? "danger" : "neutral"}>
                                {openRequests}
                              </CountPill>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            {canViewShifts ? (
                              <CountPill tone="info">{shifts.length}</CountPill>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="truncate" title={roles.join(", ")}>
                            {roles.length > 0 ? roles.join(", ") : "—"}
                          </td>
                          <td>
                            {attention ? (
                              <RefChip tone="warning" className="font-normal">
                                Needs attention
                              </RefChip>
                            ) : (
                              <RefChip
                                tone={FACILITY_TONE[facility.status]}
                                className="font-normal"
                              >
                                {FACILITY_STATUS_LABELS[facility.status]}
                              </RefChip>
                            )}
                          </td>
                          <td>
                            {relationship ? (
                              <RefChip
                                tone={RELATIONSHIP_TONE[relationship.status]}
                                className="font-normal"
                              >
                                {RELATIONSHIP_STATUS_LABELS[relationship.status]}
                              </RefChip>
                            ) : canViewRelationship ? (
                              <span className="text-muted-foreground">None</span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="text-right">
                            {detail ? (
                              <DetailDrawerTrigger
                                triggerLabel="⋮"
                                triggerClassName="justify-center px-2 text-xl font-bold text-chelth-navy no-underline sm:min-h-9"
                                triggerAccessibleLabel={`Details for ${facility.name}`}
                                title="Facility Details"
                                width="profile"
                              >
                                <FacilityDetailsPanel
                                  facility={detail}
                                  typeName={type}
                                  locations={locations}
                                  relationship={relationship}
                                  upcoming={shifts}
                                  requests={requests}
                                  recordHref={href}
                                  shiftsHref={
                                    `${orgBase}/shifts?facilityId=${facility.id}&from=${today}` as Route
                                  }
                                  shiftHref={(shiftId) => `${orgBase}/shifts/${shiftId}` as Route}
                                  canViewShifts={canViewShifts}
                                  canViewRelationship={canViewRelationship}
                                />
                              </DetailDrawerTrigger>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </DataTableRegion>
            </div>
          )}

          {shown.length > 0 ? (
            <nav
              aria-label="Facilities pages"
              className="flex flex-wrap items-center justify-between gap-3 pt-2"
            >
              <p className="text-[14px] text-slate-600">
                Showing {firstShown}–{lastShown} of {shown.length}{" "}
                {shown.length === 1 ? "facility" : "facilities"}
              </p>
              {pageCount > 1 ? (
                <ul className="flex items-center gap-2">
                  {Array.from({ length: pageCount }, (_, index) => index + 1).map((target) => (
                    <li key={target}>
                      <Link
                        href={pageHref(target)}
                        aria-current={target === pageNumber ? "page" : undefined}
                        className={cn(
                          "inline-flex size-11 items-center justify-center rounded-md border text-[14px] font-medium sm:size-9",
                          target === pageNumber
                            ? "border-chelth-teal-dark bg-chelth-teal-dark text-white"
                            : "border-chelth-border bg-white/90 text-chelth-navy hover:bg-surface-muted",
                        )}
                      >
                        {target}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </nav>
          ) : null}
        </section>
      </div>
    </div>
  );

  /** Whether any filter other than `except` is active (for card active states / copy). */
  function hasOtherThan(except: "status") {
    return Boolean(
      (except !== "status" && statusFilter) ||
      selectedType ||
      relationshipFilter ||
      attentionFilter ||
      requestsFilter ||
      search,
    );
  }
}

/** Locked count pill (reference "Open Requests" / "Upcoming Shifts" cells). */
function CountPill({
  tone,
  children,
}: {
  tone: "danger" | "info" | "neutral";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[26px] min-w-[30px] items-center justify-center rounded-lg px-2 text-[13px] font-semibold tabular-nums",
        tone === "danger" && "bg-danger-soft text-danger-soft-foreground",
        tone === "info" && "bg-info-soft text-info-soft-foreground",
        tone === "neutral" && "bg-neutral-soft text-neutral-soft-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** Locked Facilities filter control: 46 px, hairline border, optional leading icon. */
function FilterSelect({
  id,
  name,
  label,
  value,
  className,
  icon,
  children,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  className?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex h-[46px] min-w-36 items-center gap-2 rounded-md border border-chelth-border bg-white/90 pl-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring",
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="text-chelth-navy [&>svg]:size-[18px]">
          {icon}
        </span>
      ) : null}
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <select
        id={id}
        name={name}
        defaultValue={value}
        className="h-full min-w-0 flex-1 bg-transparent pr-3 text-base font-medium text-chelth-navy outline-none sm:text-[13.5px]"
      >
        {children}
      </select>
    </span>
  );
}
