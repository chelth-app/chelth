import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import {
  InitialsAvatar,
  KpiNote,
  REF_TABLE,
  REF_TEXT,
  RefChip,
  RefKpiCard,
  RefPanel,
} from "@/components/reference/locked-reference";
import { DataTableRegion } from "@/components/ui/data-table";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import type { OrganisationPageContext } from "@/features/organisations";
import {
  type AgencyTimesheetRow,
  listAgencyTimesheets,
  listTimesheetEntries,
  listTimesheetHistory,
  timesheetFilterSchema,
} from "@/features/timesheets";
import { CAPABILITIES } from "@/lib/authz";
import {
  formatPeriod,
  formatWorkedMinutes,
  HISTORY_ACTION_LABELS,
  TIMESHEET_STATUS_LABELS,
  TIMESHEET_STATUSES,
  type TimesheetStatus,
} from "@/lib/domain/timesheets";
import { cn } from "@/lib/utils/cn";

import { activityWhen, reasonLabel } from "./history-format";
import { type TimesheetDetails, TimesheetDetailsPanel } from "./timesheet-details-panel";
import { TIMESHEET_TONE } from "./timesheet-tones";

/**
 * Drawer details (shifts and history) are read for at most this many listed
 * timesheets per view; further rows open the record for them.
 */
const DETAIL_LIMIT = 25;
const ACTIVITY_LIMIT = 6;

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

/** "Oct 5 – Oct 11" (calendar dates, UTC so the stored date never shifts). */
function compactPeriod(periodStart: string, periodEnd: string): string {
  const format = (value: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(
      new Date(`${value}T00:00:00Z`),
    );
  return `${format(periodStart)} – ${format(periodEnd)}`;
}

function weekOf(period: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${period}T00:00:00Z`));
}

/**
 * Agency Timesheets (locked Timesheets reference). Weekly timesheets per
 * worker, derived from attendance by the database. Every figure is a count of
 * loaded records; worker, facility and search narrow the loaded week only.
 */
export async function AgencyTimesheets({
  context,
  raw,
}: {
  context: OrganisationPageContext;
  raw: SearchParams;
}) {
  const { organisationId, can } = context;
  const filter = timesheetFilterSchema.parse({
    period: first(raw.period),
    status: first(raw.status),
  });
  const workerFilter = first(raw.worker);
  const facilityFilter = first(raw.facility);
  const search = first(raw.q)?.trim().slice(0, 100) ?? "";
  // One read for the chosen week (any status): counts, options and the list.
  const inPeriod = await listAgencyTimesheets(organisationId, { period: filter.period });

  const workers = [...new Set(inPeriod.map((row) => row.workerName ?? "Worker"))].sort();
  const facilities = [...new Set(inPeriod.flatMap((row) => row.facilities))].sort();
  const selectedWorker = workers.find((name) => name === workerFilter);
  const selectedFacility = facilities.find((name) => name === facilityFilter);
  const needle = search.toLowerCase();
  const shown = inPeriod.filter((row) => {
    if (filter.status && row.status !== filter.status) return false;
    if (selectedWorker && (row.workerName ?? "Worker") !== selectedWorker) return false;
    if (selectedFacility && !row.facilities.includes(selectedFacility)) return false;
    if (
      needle &&
      !(row.workerName ?? "").toLowerCase().includes(needle) &&
      !row.facilities.some((name) => name.toLowerCase().includes(needle))
    ) {
      return false;
    }
    return true;
  });

  const detailed = shown.slice(0, DETAIL_LIMIT);
  const loaded = await Promise.all(
    detailed.map(async (row) => {
      const [entries, history] = await Promise.all([
        listTimesheetEntries(row.id),
        listTimesheetHistory(row.id),
      ]);
      return [row.id, { entries, history }] as const;
    }),
  );
  const details = new Map<string, TimesheetDetails>(loaded);
  const activity = detailed
    .flatMap((row) => (details.get(row.id)?.history ?? []).map((item) => ({ item, row })))
    .sort((a, b) => b.item.occurredAt.localeCompare(a.item.occurredAt))
    .slice(0, ACTIVITY_LIMIT);

  const canApprove = can(CAPABILITIES.TIMESHEET_APPROVE) === "granted";
  const canSeeAttendance = can(CAPABILITIES.ATTENDANCE_VIEW) === "granted";
  const canViewShifts = can(CAPABILITIES.SHIFT_VIEW) === "granted";
  const orgBase = `/app/organisations/${organisationId}` as const;
  const base = `${orgBase}/timesheets` as const;
  const recordHref = (row: AgencyTimesheetRow) => `${base}/${row.id}` as Route;

  const count = (status: TimesheetStatus) => inPeriod.filter((row) => row.status === status).length;
  const narrowed = Boolean(selectedWorker || selectedFacility || search);
  const quick = (status: TimesheetStatus) => {
    const query = new URLSearchParams({
      ...(filter.period ? { period: filter.period } : {}),
      status,
    });
    return {
      href: `${base}?${query.toString()}` as Route,
      active: filter.status === status && !narrowed,
    };
  };
  const toResolve = (status: TimesheetStatus) =>
    inPeriod.filter((row) => row.status === status && row.issueCount > 0).length;
  const awaitingFacility = count("agency_approved");
  const discrepancies = inPeriod.reduce((sum, row) => sum + row.disputedCount, 0);
  const hasFilters = Boolean(filter.period || filter.status || narrowed);

  return (
    <div className="chelth-locked flex flex-col gap-[13px]">
      <PageHeader
        variant="reference"
        className="xl:mb-1"
        title="Timesheets"
        description={
          <p>
            Review worked time, attendance-derived hours, and timesheet approvals across your
            workforce.
          </p>
        }
        primaryAction={
          // Period context: the week chosen in the filters below (read-only).
          <span className="inline-flex h-11 items-center gap-2.5 rounded-lg border border-chelth-border bg-white/90 px-3.5 text-[14px] font-medium text-chelth-navy shadow-[0_1px_2px_rgba(13,47,66,0.04)]">
            <WorkspaceNavIcon name="shifts" strokeWidth={2.1} className="size-[18px]" />
            {filter.period ? `Week starting ${weekOf(filter.period)}` : "All weeks"}
          </span>
        }
      />

      {/* Locked: with Timesheet Details open on wide screens the work area contracts beside it. */}
      <div className="flex flex-col gap-[13px] min-[1536px]:has-[dialog[open]]:pr-[407px]">
        {/* Real lifecycle counts for the chosen week; each card filters the list. */}
        <section
          aria-label="Timesheets by status"
          className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-[13px]"
        >
          <RefKpiCard
            label="Pending Submission"
            value={count("open")}
            supporting="Not yet submitted"
            footer={<KpiNote tone="warning">{toResolve("open")} to resolve</KpiNote>}
            glyph="document"
            icon={<WorkspaceNavIcon name="timesheets" strokeWidth={2.25} duotone />}
            tone="info"
            {...quick("open")}
          />
          <RefKpiCard
            label="Needs Review"
            value={count("submitted")}
            supporting="Submitted for review"
            footer={<KpiNote tone="warning">{toResolve("submitted")} to resolve</KpiNote>}
            glyph="clock"
            icon={<WorkspaceNavIcon name="attendance" strokeWidth={2.25} duotone />}
            tone="warning"
            {...quick("submitted")}
          />
          <RefKpiCard
            label="Approved"
            value={count("locked")}
            supporting="Sign-off complete"
            footer={<KpiNote tone="info">{awaitingFacility} awaiting facility</KpiNote>}
            glyph="document"
            icon={<WorkspaceNavIcon name="compliance" strokeWidth={2.25} duotone />}
            tone="teal"
            {...quick("locked")}
          />
          <RefKpiCard
            label="Needs Correction"
            value={count("rejected")}
            supporting="Returned to worker"
            footer={
              <KpiNote tone="danger">
                {discrepancies} {discrepancies === 1 ? "discrepancy" : "discrepancies"}
              </KpiNote>
            }
            glyph="alert"
            icon={<WorkspaceNavIcon name="requests" strokeWidth={2.25} duotone />}
            tone="danger"
            {...quick("rejected")}
          />
        </section>

        {/* Locked filter row: week and status are real list filters; worker, facility and
            search narrow the loaded week. */}
        <form
          key={JSON.stringify([filter, selectedWorker, selectedFacility, search])}
          aria-label="Filter timesheets"
          method="get"
          className="flex flex-wrap items-center gap-[9px]"
        >
          <span className="flex h-[46px] min-w-44 items-center gap-2 rounded-md border border-chelth-border bg-white/90 px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring">
            <WorkspaceNavIcon
              name="shifts"
              strokeWidth={2.1}
              className="size-[18px] shrink-0 text-chelth-navy"
            />
            <Label htmlFor="timesheet-period" className="sr-only">
              Week starting
            </Label>
            <input
              id="timesheet-period"
              name="period"
              type="date"
              defaultValue={filter.period ?? ""}
              className="h-full w-0 min-w-0 flex-1 bg-transparent text-base font-medium text-chelth-navy outline-none sm:w-auto sm:flex-none sm:text-[13.5px]"
            />
          </span>
          <FilterSelect
            id="timesheet-worker"
            name="worker"
            label="Worker"
            value={selectedWorker ?? ""}
            className="xl:w-[168px]"
            icon={<WorkspaceNavIcon name="workforce" strokeWidth={2.1} />}
          >
            <option value="">All workers</option>
            {workers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            id="timesheet-facility"
            name="facility"
            label="Facility"
            value={selectedFacility ?? ""}
            className="xl:w-[176px]"
            icon={<WorkspaceNavIcon name="facilities" strokeWidth={2.1} />}
          >
            <option value="">All facilities</option>
            {facilities.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            id="timesheet-status"
            name="status"
            label="Status"
            value={filter.status ?? ""}
            className="xl:w-[200px]"
          >
            <option value="">All statuses</option>
            {TIMESHEET_STATUSES.map((status) => (
              <option key={status} value={status}>
                {TIMESHEET_STATUS_LABELS[status]}
              </option>
            ))}
          </FilterSelect>
          <span className="flex h-[46px] min-w-44 flex-1 items-center gap-2.5 rounded-md border border-chelth-border bg-white/90 px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring xl:max-w-[260px]">
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
            <Label htmlFor="timesheet-search" className="sr-only">
              Search timesheets
            </Label>
            <input
              id="timesheet-search"
              name="q"
              type="search"
              defaultValue={search}
              placeholder="Search timesheets…"
              className="h-full min-w-0 flex-1 bg-transparent text-base text-chelth-navy outline-none placeholder:text-muted-foreground sm:text-[13.5px]"
            />
          </span>
          <button
            type="submit"
            className="inline-flex h-11 items-center rounded-md border border-chelth-border bg-white/90 px-4 text-[13.5px] font-medium text-chelth-navy hover:bg-surface-muted sm:h-[46px]"
          >
            Show
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

        <div id="current-timesheets" className="scroll-mt-24">
          <RefPanel
            title="Current Timesheets"
            titleId="timesheets-heading"
            action={
              <span className="text-[13.5px] text-muted-foreground">
                {shown.length === 1 ? "1 timesheet" : `${shown.length} timesheets`}
              </span>
            }
          >
            {inPeriod.length === 0 ? (
              <TimesheetsEmpty
                title={filter.period ? "No timesheets for this week." : "No timesheets yet."}
                note="Timesheets are created from attendance once a worker has worked a shift."
              />
            ) : shown.length === 0 ? (
              <TimesheetsEmpty
                title={
                  filter.status === "submitted" && !narrowed
                    ? "No timesheets waiting for review."
                    : "No timesheets match these filters."
                }
                note="Change the week, status or search to see others."
              />
            ) : (
              <DataTableRegion
                aria-label="Agency timesheets table"
                className="mt-[9px] rounded-none border-0 bg-transparent"
              >
                <table className={cn(REF_TABLE, "min-w-[880px] table-fixed")}>
                  <colgroup>
                    <col className="w-[20%]" />
                    <col className="w-[18%]" />
                    <col className="w-[13%]" />
                    <col className="w-[7%]" />
                    <col className="w-[11%]" />
                    <col className="w-[11%]" />
                    <col className="w-[16%]" />
                    <col className="w-[4%]" />
                  </colgroup>
                  <thead className={REF_TEXT.tableHead}>
                    <tr>
                      <th scope="col">Worker</th>
                      <th scope="col">Facility</th>
                      <th scope="col">Week</th>
                      <th scope="col">Shifts</th>
                      <th scope="col">Worked Hours</th>
                      <th scope="col">Source</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="sr-only">Details</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className={REF_TEXT.tableBody}>
                    {shown.map((row) => {
                      const worker = row.workerName ?? "Worker";
                      const flags = [
                        ...(row.revision > 1 ? [`Revision ${row.revision}`] : []),
                        ...(row.issueCount > 0
                          ? [
                              row.issueCount === 1
                                ? "1 shift to resolve"
                                : `${row.issueCount} shifts to resolve`,
                            ]
                          : []),
                        ...(row.disputedCount > 0 ? ["Discrepancy"] : []),
                        ...(row.pendingFacilityCount > 0 ? ["Awaiting facility"] : []),
                      ];
                      const rowDetails = details.get(row.id) ?? null;
                      const included = rowDetails?.entries.filter((entry) => entry.included) ?? [];
                      const onlyShift = included.length === 1 ? included[0] : undefined;
                      return (
                        <tr
                          key={row.id}
                          className="h-[42px] transition-colors hover:bg-surface-muted/50 has-[dialog[open]]:bg-chelth-mint-mist/70 [&:has(dialog[open])>*:first-child]:shadow-[inset_3px_0_0_var(--chelth-teal)]"
                        >
                          <td>
                            <span className="flex items-center gap-2.5">
                              <InitialsAvatar name={row.workerName} />
                              <Link
                                href={recordHref(row)}
                                className="truncate font-medium text-chelth-navy hover:text-primary hover:underline hover:underline-offset-4"
                              >
                                {worker}
                              </Link>
                            </span>
                          </td>
                          <td>
                            <span className="line-clamp-2" title={row.facilities.join(", ")}>
                              {row.facilities.length > 0 ? row.facilities.join(", ") : "—"}
                            </span>
                          </td>
                          <td
                            className="whitespace-nowrap"
                            title={formatPeriod(row.periodStart, row.periodEnd)}
                          >
                            {compactPeriod(row.periodStart, row.periodEnd)}
                          </td>
                          <td className="tabular-nums">{row.entryCount}</td>
                          <td className="whitespace-nowrap tabular-nums">
                            {formatWorkedMinutes(row.totalWorkedMinutes)}
                          </td>
                          <td className="pr-3!">
                            <RefChip tone="info" className="font-normal">
                              Attendance
                            </RefChip>
                          </td>
                          <td className="pl-4!">
                            <span className="flex flex-col items-start gap-1 py-2">
                              <RefChip tone={TIMESHEET_TONE[row.status]} className="font-normal">
                                {TIMESHEET_STATUS_LABELS[row.status]}
                              </RefChip>
                              {flags.length > 0 ? (
                                <span className="text-[11.5px] leading-4 text-slate-600">
                                  {flags.join(" · ")}
                                </span>
                              ) : null}
                            </span>
                          </td>
                          <td className="text-right">
                            <DetailDrawerTrigger
                              triggerLabel="⋮"
                              triggerClassName="justify-center px-2 text-xl font-bold text-chelth-navy no-underline sm:min-h-9"
                              triggerAccessibleLabel={`Details for ${worker}, week ${compactPeriod(row.periodStart, row.periodEnd)}`}
                              title="Timesheet Details"
                              width="profile"
                            >
                              <TimesheetDetailsPanel
                                row={row}
                                details={rowDetails}
                                recordHref={recordHref(row)}
                                reviewHref={
                                  canApprove && row.status === "submitted"
                                    ? (`${recordHref(row)}#review-heading` as Route)
                                    : null
                                }
                                attendanceHref={
                                  canSeeAttendance
                                    ? (`${orgBase}/attendance?from=${row.periodStart}&to=${row.periodEnd}` as Route)
                                    : null
                                }
                                attendanceRecordHref={
                                  canSeeAttendance
                                    ? (attendanceId) =>
                                        `${orgBase}/attendance/${attendanceId}` as Route
                                    : null
                                }
                                shiftsHref={
                                  !canViewShifts
                                    ? null
                                    : onlyShift
                                      ? {
                                          href: `${orgBase}/shifts/${onlyShift.shiftId}` as Route,
                                          label: "View Shift",
                                        }
                                      : {
                                          href: `${orgBase}/shifts?from=${row.periodStart}&to=${row.periodEnd}` as Route,
                                          label: "View Shifts",
                                        }
                                }
                              />
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
        </div>

        <RefPanel
          title="Recent Timesheet Activity"
          titleId="timesheet-activity-heading"
          action={<span className="text-[13.5px] text-muted-foreground">Listed timesheets</span>}
        >
          {activity.length === 0 ? (
            <TimesheetsEmpty
              title="No timesheet activity yet."
              note="Submissions, approvals, returns and revisions appear here; nothing is ever removed."
            />
          ) : (
            <DataTableRegion
              aria-label="Timesheet activity table"
              className="mt-[9px] rounded-none border-0 bg-transparent"
            >
              <table className={cn(REF_TABLE, "min-w-[820px] table-fixed")}>
                <colgroup>
                  <col className="w-[13%]" />
                  <col className="w-[18%]" />
                  <col className="w-[19%]" />
                  <col className="w-[18%]" />
                  <col className="w-[16%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <thead className={REF_TEXT.tableHead}>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Worker</th>
                    <th scope="col">Facility</th>
                    <th scope="col">Event</th>
                    <th scope="col">Details</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody className={REF_TEXT.tableBody}>
                  {activity.map(({ item, row }, index) => (
                    <tr
                      key={`${row.id}-${item.action}-${item.occurredAt}-${index}`}
                      className="h-[42px] transition-colors hover:bg-surface-muted/50"
                    >
                      <td className="whitespace-nowrap">
                        <time dateTime={item.occurredAt} className="tabular-nums">
                          {activityWhen.format(new Date(item.occurredAt))}
                        </time>
                      </td>
                      <td>
                        <span className="flex items-center gap-2.5">
                          <InitialsAvatar name={row.workerName} />
                          <Link
                            href={recordHref(row)}
                            className="truncate font-medium text-chelth-navy hover:text-primary hover:underline hover:underline-offset-4"
                          >
                            {row.workerName ?? "Worker"}
                          </Link>
                        </span>
                      </td>
                      <td className="truncate">{row.facilities.join(", ") || "—"}</td>
                      <td className="truncate">{HISTORY_ACTION_LABELS[item.action]}</td>
                      <td className="truncate">
                        {[
                          reasonLabel(item.reasonCode),
                          item.revision > 1 ? `Revision ${item.revision}` : null,
                          // Name the actor only when it is not the worker themselves.
                          item.actorName && item.actorName !== row.workerName
                            ? `By ${item.actorName}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td>
                        <RefChip tone={TIMESHEET_TONE[row.status]} className="font-normal">
                          {TIMESHEET_STATUS_LABELS[row.status]}
                        </RefChip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTableRegion>
          )}
        </RefPanel>
      </div>
    </div>
  );
}

/** Deliberate empty state inside a reference panel. */
function TimesheetsEmpty({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-center gap-3 px-[5px] py-3">
      <span
        aria-hidden="true"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-muted text-muted-foreground [&>svg]:size-[19px]"
      >
        <WorkspaceNavIcon name="timesheets" strokeWidth={2} />
      </span>
      <span className="flex flex-col">
        <span className="text-[14px] leading-5 font-medium text-slate-600">{title}</span>
        <span className="text-[12.5px] leading-[18px] text-muted-foreground">{note}</span>
      </span>
    </div>
  );
}

/** Locked filter control (Facilities): 46 px, hairline border, optional leading icon. */
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
