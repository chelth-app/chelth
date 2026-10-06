import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import {
  InitialsAvatar,
  KpiAction,
  REF_CARD,
  REF_TEXT,
  RefChip,
  RefKpiCard,
} from "@/components/reference/locked-reference";
import { DataTablePagination, DataTableRegion } from "@/components/ui/data-table";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { PageHeader } from "@/components/ui/page-header";
import { Label } from "@/components/ui/label";
import { LocationPin } from "@/components/ui/location-pin";
import type { StatusTone } from "@/components/ui/status-chip";
import { listDisciplines } from "@/features/credentials";
import { loadOrganisationPage, requireCapabilityOrNotFound } from "@/features/organisations";
import {
  type AgencyShiftSummary,
  type AssignmentReadiness,
  CreateShiftForm,
  decodeCursor,
  FILL_TONE,
  listAgencyShifts,
  listAgencyShiftsPage,
  listAssignmentReadiness,
  listFacilityFilterOptions,
  listSchedulableLocations,
  listShiftAssignments,
  listShiftNotes,
  SHIFT_TONE,
  type ShiftAssignment,
  shiftFiltersSchema,
  type ShiftNote,
} from "@/features/shifts";
import { CAPABILITIES } from "@/lib/authz";
import { READINESS_LABELS, type ReadinessStatus } from "@/lib/domain/credentials";
import {
  disciplineNameParts,
  FILL_STATE_LABELS,
  formatShiftDate,
  formatShiftTimeRange,
  formatShiftTimeRangeParts,
  hasEnded,
  hasStarted,
  SHIFT_STATUS_LABELS,
  SHIFT_STATUSES,
  type ShiftStatus,
  todayIsoDate,
} from "@/lib/domain/shifts";
import { cn } from "@/lib/utils/cn";

import { addDaysIso, ShiftCalendar, weekStartOf } from "./_components/shift-calendar";
import { type ShiftListItem, ShiftDetailsPanel } from "./_components/shift-details-panel";

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
  // Locked Shifts reference: List (default) or Calendar (one week), kept in the URL.
  const view = first(raw.view) === "calendar" ? "calendar" : "list";
  const rawWeek = first(raw.week);
  const weekStart = weekStartOf(
    rawWeek && /^\d{4}-\d{2}-\d{2}$/.test(rawWeek) && !Number.isNaN(Date.parse(rawWeek))
      ? rawWeek
      : todayIsoDate(),
  );
  const cursor = view === "list" ? decodeCursor(first(raw.after)) : null;
  const [page, facilities, locations, disciplines] = await Promise.all([
    view === "list"
      ? listAgencyShiftsPage(organisationId, filters, cursor)
      : // The calendar shows every shift in the week (same query, week window).
        listAgencyShiftsPage(
          organisationId,
          {
            ...(filters.status ? { status: filters.status } : {}),
            ...(filters.facilityId ? { facilityId: filters.facilityId } : {}),
            from: weekStart,
            to: addDaysIso(weekStart, 6),
          },
          null,
          200,
        ),
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
  const upcomingOpen = upcoming.filter((shift) => shift.status === "open");
  const fullyStaffed = upcomingOpen.filter((shift) => shift.fillState === "filled").length;
  const notFullyStaffed = upcomingOpen.length - fullyStaffed;
  const hasFilters = Boolean(filters.status || filters.facilityId || filters.from || filters.to);
  const viewHref = (target: "list" | "calendar", week?: string | null) => {
    const query = new URLSearchParams();
    if (filters.status) query.set("status", filters.status);
    if (filters.facilityId) query.set("facilityId", filters.facilityId);
    if (target === "list") {
      if (filters.from) query.set("from", filters.from);
      if (filters.to) query.set("to", filters.to);
    } else {
      query.set("view", "calendar");
      if (week) query.set("week", week);
    }
    const text = query.toString();
    return (text ? `${base}?${text}` : base) as Route;
  };
  const pendingCount = upcomingOpen.reduce(
    (total, shift) => total + Math.max(shift.activeCount - shift.acceptedCount, 0),
    0,
  );
  const acceptedCount = upcomingOpen.reduce((total, shift) => total + shift.acceptedCount, 0);
  const facilitiesWithOpen = new Set(upcomingOpen.map((shift) => shift.facilityId)).size;

  // Assignees and readiness for the rows on this page: the shift record's own
  // loaders and capability gates, called only for rows that have assignments.
  const canViewAssignments = can(CAPABILITIES.ASSIGNMENT_VIEW) === "granted";
  const canSeeReadiness = canViewAssignments && can(CAPABILITIES.COMPLIANCE_VIEW) === "granted";
  const canAssign =
    can(CAPABILITIES.ASSIGNMENT_MANAGE) === "granted" &&
    can(CAPABILITIES.COMPLIANCE_VIEW) === "granted";
  const staffed = new Set(
    shifts.filter((shift) => shift.activeCount + shift.acceptedCount > 0).map((shift) => shift.id),
  );
  const details = new Map<
    string,
    { assignments: ShiftAssignment[]; readiness: AssignmentReadiness[]; notes: ShiftNote[] }
  >(
    await Promise.all(
      shifts.map(async (shift) => {
        const [assignments, readiness, notes] = await Promise.all([
          canViewAssignments && staffed.has(shift.id)
            ? listShiftAssignments(shift.id)
            : Promise.resolve([]),
          canSeeReadiness && staffed.has(shift.id)
            ? listAssignmentReadiness(organisationId, shift.id)
            : Promise.resolve([]),
          // Internal notes: the shift record's own loader (agency only, RLS).
          listShiftNotes(shift.id),
        ]);
        return [shift.id, { assignments, readiness, notes }] as const;
      }),
    ),
  );
  const activeOf = (shiftId: string) =>
    (details.get(shiftId)?.assignments ?? []).filter(
      (assignment) => assignment.status === "assigned" || assignment.status === "accepted",
    );
  const renderDetails = (shift: ShiftListItem) => {
    const isOpen = shift.status === "open" && !hasEnded(shift);
    const canStaff = canAssign && isOpen && shift.relationshipStatus === "active";
    return (
      <ShiftDetailsPanel
        shift={shift}
        href={`${base}/${shift.id}` as Route}
        assignments={activeOf(shift.id)}
        readiness={details.get(shift.id)?.readiness ?? []}
        notes={details.get(shift.id)?.notes ?? null}
        canSeeAssignments={canViewAssignments}
        canStaff={canStaff}
        canOffer={canStaff && !hasStarted(shift)}
      />
    );
  };

  const createAction =
    canCreate && locations.length > 0 ? (
      <a
        href="#create-shift"
        className="inline-flex h-11 items-center justify-center gap-2.5 rounded-[8px] bg-[linear-gradient(180deg,#00666c,#004f55)] px-4 text-[14px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_14px_-4px_rgba(0,58,64,0.45)] transition-[filter] hover:brightness-110 sm:ml-auto"
      >
        <span aria-hidden="true" className="text-[19px] leading-none font-normal">
          +
        </span>
        Create shift
      </a>
    ) : null;

  return (
    // Locked: with Shift Details open on wide screens, the work area contracts
    // beside the docked panel; closing it expands again (CSS :has, no state).
    <div className="chelth-locked flex flex-col gap-[13px] min-[1536px]:has-[dialog[open]]:pr-[407px]">
      <PageHeader
        variant="reference"
        className="xl:mb-1"
        title="Shifts"
        description={
          <p>
            Plan, assign, and track shift coverage across facilities. Times are shown in each
            facility location&apos;s own timezone.
          </p>
        }
      />

      {/* Locked toolbar: date range (List), facility, status, apply, Create shift. */}
      <section aria-labelledby="shift-filters-heading">
        <h2 id="shift-filters-heading" className="sr-only">
          Filter shifts
        </h2>
        <form
          key={JSON.stringify([filters, view])}
          aria-label="Filter shifts"
          method="get"
          className="flex flex-wrap items-center gap-[9px]"
        >
          {view === "calendar" ? (
            <>
              <input type="hidden" name="view" value="calendar" />
              <input type="hidden" name="week" value={weekStart} />
            </>
          ) : (
            <div className={cn(TOOLBAR, "w-full gap-2 px-3 sm:w-auto")}>
              <WorkspaceNavIcon
                name="shifts"
                strokeWidth={2.1}
                className="size-[18px] shrink-0 text-chelth-navy"
              />
              <Label htmlFor="filter-from" className="sr-only">
                From
              </Label>
              <input
                id="filter-from"
                name="from"
                type="date"
                defaultValue={filters.from ?? ""}
                className="w-0 min-w-0 flex-1 bg-transparent text-base font-medium text-chelth-navy outline-none sm:w-auto sm:flex-none sm:text-[13.5px]"
              />
              <span aria-hidden="true" className="text-muted-foreground">
                –
              </span>
              <Label htmlFor="filter-to" className="sr-only">
                To
              </Label>
              <input
                id="filter-to"
                name="to"
                type="date"
                defaultValue={filters.to ?? ""}
                className="w-0 min-w-0 flex-1 bg-transparent text-base font-medium text-chelth-navy outline-none sm:w-auto sm:flex-none sm:text-[13.5px]"
              />
            </div>
          )}
          <span className={cn(TOOLBAR, "min-w-40 gap-2 pl-3 xl:w-[200px]")}>
            <WorkspaceNavIcon
              name="facilities"
              strokeWidth={2.1}
              className="size-[18px] shrink-0 text-chelth-navy"
            />
            <Label htmlFor="filter-facility" className="sr-only">
              Facility
            </Label>
            <select
              id="filter-facility"
              name="facilityId"
              defaultValue={filters.facilityId ?? ""}
              className={TOOLBAR_SELECT}
            >
              <option value="">All facilities</option>
              {facilities.map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.name}
                </option>
              ))}
            </select>
          </span>
          <span className={cn(TOOLBAR, "min-w-40 pl-3 xl:w-[180px]")}>
            <Label htmlFor="filter-status" className="sr-only">
              Status
            </Label>
            <select
              id="filter-status"
              name="status"
              defaultValue={filters.status ?? ""}
              className={TOOLBAR_SELECT}
            >
              <option value="">All statuses</option>
              {SHIFT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {SHIFT_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </span>
          <button
            type="submit"
            className={cn(TOOLBAR, "justify-center px-4 font-medium hover:bg-surface-muted")}
          >
            Apply filters
          </button>
          {hasFilters ? (
            <Link
              href={(view === "calendar" ? viewHref("calendar", weekStart) : base) as Route}
              className="inline-flex min-h-11 items-center px-1 text-[13px] font-medium text-primary underline underline-offset-4"
            >
              Clear filters
            </Link>
          ) : null}
          {createAction}
        </form>
      </section>

      <section
        aria-label="Upcoming shifts"
        className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-[13px]"
      >
        <RefKpiCard
          size="md"
          label="Open Shifts"
          value={openQuick.count}
          supporting={`Across ${facilitiesWithOpen} ${facilitiesWithOpen === 1 ? "facility" : "facilities"}`}
          footer={<KpiAction>View shifts</KpiAction>}
          glyph="calendar"
          icon={<WorkspaceNavIcon name="shifts" strokeWidth={2.25} duotone />}
          tone="danger"
          href={openQuick.href}
          active={openQuick.active}
        />
        <RefKpiCard
          size="md"
          label="Pending"
          value={pendingCount}
          supporting="Awaiting acceptance"
          footer={<KpiAction>View shifts</KpiAction>}
          glyph="clock"
          icon={<WorkspaceNavIcon name="attendance" strokeWidth={2.25} duotone />}
          tone="warning"
          href={openQuick.href}
        />
        <RefKpiCard
          size="md"
          label="Confirmed"
          value={acceptedCount}
          supporting="Workers accepted"
          footer={<KpiAction>View shifts</KpiAction>}
          glyph="people"
          icon={<WorkspaceNavIcon name="workforce" strokeWidth={2.25} duotone />}
          tone="teal"
          href={openQuick.href}
        />
        <RefKpiCard
          size="md"
          label="Not Fully Staffed"
          value={notFullyStaffed}
          supporting="Places still to fill"
          footer={<KpiAction>View shifts</KpiAction>}
          glyph="alert"
          icon={<WorkspaceNavIcon name="compliance" strokeWidth={2.25} duotone />}
          tone="danger"
          href={openQuick.href}
        />
      </section>

      {/* Locked List / Calendar segmented control (each view is a URL). */}
      <nav aria-label="Shift views" className="flex">
        <ul className="inline-flex rounded-[10px] border border-chelth-border/80 bg-white p-1 shadow-[0_1px_2px_rgba(13,47,66,0.05)]">
          {(
            [
              { key: "list", label: "List", icon: "requests" },
              { key: "calendar", label: "Calendar", icon: "shifts" },
            ] as const
          ).map((option) => {
            const current = view === option.key;
            return (
              <li key={option.key}>
                <Link
                  href={viewHref(option.key, option.key === "calendar" ? weekStart : null)}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-10 items-center gap-2 rounded-[8px] px-4 text-[14px] font-semibold transition-colors sm:min-w-[104px] sm:justify-center",
                    current
                      ? "bg-[linear-gradient(180deg,#00666c,#004f55)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_4px_10px_-4px_rgba(0,58,64,0.45)]"
                      : "text-chelth-navy hover:bg-chelth-mint-mist/60",
                  )}
                >
                  <WorkspaceNavIcon
                    name={option.icon}
                    strokeWidth={2}
                    className={cn("size-[18px]", current ? "text-white" : "text-chelth-teal-dark")}
                  />
                  {option.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {view === "calendar" ? (
        <ShiftCalendar
          shifts={shifts}
          assignmentsOf={activeOf}
          canSeeAssignments={canViewAssignments}
          weekStart={weekStart}
          today={today}
          hrefFor={(week) => viewHref("calendar", week)}
          renderDetails={renderDetails}
        />
      ) : (
        <section
          aria-labelledby="shift-list-heading"
          className={cn(REF_CARD, "flex flex-col overflow-hidden")}
        >
          <div className="flex min-h-[52px] items-center justify-between gap-3 px-[15px]">
            <h2
              id="shift-list-heading"
              className="font-display text-[18px] leading-6 font-semibold tracking-[-0.02em] text-chelth-navy"
            >
              Shifts
            </h2>
            <p className="text-[12.5px] text-muted-foreground">
              Sorted by <span className="font-medium text-primary">start time</span>
            </p>
          </div>
          <DataTableRegion
            aria-label="Shifts table"
            className="rounded-none border-0 bg-transparent"
          >
            <table className="w-full min-w-[960px] table-fixed border-separate border-spacing-0 text-left">
              <colgroup>
                <col className="w-[14%]" />
                <col className="w-[12.4%]" />
                <col className="w-[16.9%]" />
                <col className="w-[14.9%]" />
                <col className="w-[11.8%]" />
                <col className="w-[10.7%]" />
                <col className="w-[12.2%]" />
                <col className="w-[7.1%]" />
              </colgroup>
              <thead
                className={cn(
                  REF_TEXT.tableHead,
                  "[&_th]:h-[30px] [&_th]:border-y [&_th]:border-chelth-border/55 [&_th]:bg-[color-mix(in_srgb,var(--chelth-mint-mist)_45%,#eef4f8)] [&_th]:px-[13px] [&_th]:whitespace-nowrap",
                )}
              >
                <tr>
                  <th scope="col">Date &amp; Time</th>
                  <th scope="col">Role</th>
                  <th scope="col">Facility</th>
                  <th scope="col">Assigned Staff</th>
                  <th scope="col">Credential Status</th>
                  <th scope="col">Confirmation</th>
                  <th scope="col">Coverage Status</th>
                  <th scope="col" className="text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="text-[11.5px] leading-[16px] text-slate-600 [&_td]:h-[52px] [&_td]:border-b [&_td]:border-chelth-border/45 [&_td]:px-[13px]">
                {shifts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8">
                      {/* Phones: pinned to the visible edge of the scrolling table so it never clips. */}
                      <div className="sticky left-3 max-w-[calc(100vw-7rem)] sm:static sm:max-w-none sm:text-center">
                        <p className="text-sm font-medium text-foreground">No shifts match.</p>
                        <p className="text-[13px] text-muted-foreground">
                          {hasFilters
                            ? "Change or clear the filters to see more shifts."
                            : "Shifts you create, and requests from facilities, appear here."}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : null}
                {shifts.map((shift) => {
                  const href = `${base}/${shift.id}` as Route;
                  const title = `${shift.facilityName} · ${shift.disciplineName} · ${formatShiftDate(shift)}`;
                  const role = disciplineNameParts(shift.disciplineName);
                  const active = activeOf(shift.id);
                  const lead = active[0];
                  const readiness = details.get(shift.id)?.readiness ?? [];
                  const coverage = coverageChip(shift);
                  const confirmation = confirmationChip(shift, active);
                  const credential = credentialChip(active, readiness);
                  return (
                    <tr
                      key={shift.id}
                      className="transition-colors hover:bg-surface-muted/50 has-[dialog[open]]:bg-chelth-mint-mist/70 [&:has(dialog[open])>td:first-child]:shadow-[inset_3px_0_0_var(--chelth-teal)]"
                    >
                      <td>
                        <div className="font-semibold text-chelth-navy">
                          {formatShiftDate(shift)}
                        </div>
                        {/* The time without its zone (the page states the rule); the zone stays for screen readers and in the drawer. */}
                        <div
                          className="truncate text-muted-foreground"
                          title={formatShiftTimeRange(shift)}
                        >
                          {formatShiftTimeRangeParts(shift).range}
                          <span className="sr-only"> {formatShiftTimeRangeParts(shift).zone}</span>
                        </div>
                      </td>
                      <td>
                        <span title={shift.disciplineName} className="line-clamp-2 font-medium">
                          {role.name}
                        </span>
                      </td>
                      <td>
                        <div className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-2">
                          <LocationPin className="mt-px size-3.5" />
                          <Link
                            href={href}
                            aria-label={title}
                            className="truncate font-medium text-chelth-navy hover:text-primary hover:underline hover:underline-offset-4"
                          >
                            {shift.facilityName}
                          </Link>
                          <span className="col-start-2 truncate text-muted-foreground">
                            {shift.locationName}
                            {shift.source === "facility" ? " · Facility request" : ""}
                            {shift.externalReference ? ` · Ref ${shift.externalReference}` : ""}
                          </span>
                        </div>
                      </td>
                      <td>
                        {lead ? (
                          <span className="flex items-center gap-2.5">
                            <InitialsAvatar name={lead.workerName} />
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate font-medium text-chelth-navy">
                                {lead.workerName}
                                {active.length > 1 ? ` +${active.length - 1}` : ""}
                              </span>
                              <span className="text-muted-foreground">
                                {role.code ?? role.name}
                              </span>
                            </span>
                          </span>
                        ) : shift.activeCount > 0 ? (
                          <span className="text-muted-foreground">
                            {shift.activeCount} assigned
                          </span>
                        ) : (
                          <span className="flex items-center gap-2.5 text-muted-foreground">
                            <InitialsAvatar name={null} muted />
                            Unassigned
                          </span>
                        )}
                      </td>
                      <td>
                        <RefChip tone={credential.tone}>{credential.label}</RefChip>
                      </td>
                      <td>
                        {shift.openIssueCount > 0 ? (
                          <RefChip tone="attention">
                            Needs attention ({shift.openIssueCount})
                          </RefChip>
                        ) : (
                          <RefChip tone={confirmation.tone}>{confirmation.label}</RefChip>
                        )}
                      </td>
                      <td>
                        {shift.relationshipStatus !== "active" ? (
                          <RefChip tone="warning">Relationship not active</RefChip>
                        ) : (
                          <RefChip tone={coverage.tone}>{coverage.label}</RefChip>
                        )}
                      </td>
                      <td className="text-right">
                        <DetailDrawerTrigger
                          triggerLabel="⋮"
                          triggerClassName="justify-center px-2 text-xl font-bold text-chelth-navy no-underline sm:min-h-9"
                          triggerAccessibleLabel={`Details for ${title}`}
                          title="Shift Details"
                          width="profile"
                        >
                          {renderDetails(shift)}
                        </DetailDrawerTrigger>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataTableRegion>
        </section>
      )}
      {view === "list" ? (
        <DataTablePagination
          label="Shift list pages"
          previousHref={cursor ? (base as Route) : null}
          previousLabel="First page"
          nextHref={page.nextCursor ? (`${base}?${nextQuery}` as Route) : null}
        />
      ) : null}

      {canCreate ? (
        // "+ Create shift" is the entry point. With a schedulable location the
        // existing form stays on this route but is revealed only when that link
        // targets it (CSS :target, no script, same action).
        <section
          id="create-shift"
          aria-labelledby="create-shift-heading"
          className={cn(
            REF_CARD,
            "scroll-mt-24 flex-col gap-3 p-4 sm:p-5",
            locations.length > 0 ? "hidden target:flex" : "flex",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <h2
              id="create-shift-heading"
              className="font-display text-[20px] leading-[26px] font-semibold tracking-[-0.02em] text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]"
            >
              Create a shift
            </h2>
            {locations.length > 0 ? (
              <a
                href="#shift-filters-heading"
                className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-primary underline underline-offset-4 hover:bg-surface-muted sm:min-h-9"
              >
                Close
              </a>
            ) : null}
          </div>
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
    </div>
  );
}

/** Locked filter control (Facilities geometry): 46 px, hairline border, 13.5 px navy text. */
const TOOLBAR =
  "flex h-11 items-center rounded-md border border-chelth-border bg-white/90 text-[13.5px] text-chelth-navy focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring sm:h-[46px]";
const TOOLBAR_SELECT =
  "h-full w-full min-w-0 flex-1 bg-transparent pr-3 text-base font-medium text-chelth-navy outline-none sm:text-[13.5px]";

/** Coverage status (P3): fill state while open, otherwise the shift status. */
function coverageChip(shift: AgencyShiftSummary): { tone: StatusTone; label: string } {
  if (shift.status === "open") {
    return shift.fillState === "unfilled"
      ? { tone: "danger", label: "Open" }
      : { tone: FILL_TONE[shift.fillState], label: FILL_STATE_LABELS[shift.fillState] };
  }
  return { tone: SHIFT_TONE[shift.status], label: SHIFT_STATUS_LABELS[shift.status] };
}

/** Confirmation (P3): has every assignee accepted? */
function confirmationChip(
  shift: AgencyShiftSummary,
  active: ShiftAssignment[],
): { tone: StatusTone; label: string } {
  const assigned = active.length || shift.activeCount;
  if (assigned === 0) return { tone: "neutral", label: "Not started" };
  const accepted = active.length
    ? active.filter((assignment) => assignment.status === "accepted").length
    : shift.acceptedCount;
  return accepted >= assigned
    ? { tone: "success", label: "Confirmed" }
    : { tone: "warning", label: "Pending" };
}

const READINESS_TONE: Record<ReadinessStatus, StatusTone> = {
  ready: "success",
  action_required: "warning",
  not_eligible: "danger",
};

/** Credential status (P3): the live readiness of the assignees, worst first. */
function credentialChip(
  active: ShiftAssignment[],
  readiness: AssignmentReadiness[],
): { tone: StatusTone; label: string } {
  const relevant = readiness.filter((entry) =>
    active.some((assignment) => assignment.id === entry.assignmentId),
  );
  if (relevant.length === 0) return { tone: "neutral", label: "Not started" };
  const order: ReadinessStatus[] = ["not_eligible", "action_required", "ready"];
  const worst =
    order.find((status) => relevant.some((entry) => entry.readiness === status)) ?? "ready";
  return { tone: READINESS_TONE[worst], label: READINESS_LABELS[worst] };
}
