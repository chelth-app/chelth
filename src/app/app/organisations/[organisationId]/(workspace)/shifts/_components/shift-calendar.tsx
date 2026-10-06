import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { InitialsAvatar, REF_CARD } from "@/components/reference/locked-reference";
import { DataTableRegion } from "@/components/ui/data-table";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import type { ShiftAssignment } from "@/features/shifts";
import {
  formatShiftDate,
  formatShiftTimeRangeParts,
  localDate,
  shiftDurationHours,
} from "@/lib/domain/shifts";
import { cn } from "@/lib/utils/cn";

import type { ShiftListItem } from "./shift-details-panel";

/*
 * Locked Shifts reference — Calendar view (week). Rows are the agency's
 * assigned staff (real assignments) plus an "Open places" row for shifts that
 * still need staff; columns are the seven days of the chosen week. Each shift
 * sits on its own facility-local date. Blocks are status-led and open the
 * canonical Shift Details drawer. Below lg the same data is an agenda list.
 */

type BlockTone = "confirmed" | "pending" | "open" | "requested" | "done" | "cancelled";

const BLOCK: Record<BlockTone, { surface: string; dot: string; label: string }> = {
  confirmed: {
    surface: "border-[rgba(15,138,93,0.22)] bg-success-soft/80",
    dot: "bg-success-indicator",
    label: "Confirmed",
  },
  pending: {
    surface: "border-[rgba(196,120,0,0.22)] bg-warning-soft/80",
    dot: "bg-warning-indicator",
    label: "Pending",
  },
  open: {
    surface: "border-[rgba(180,35,24,0.20)] bg-danger-soft/80",
    dot: "bg-danger-indicator",
    label: "Open",
  },
  requested: {
    surface: "border-[rgba(37,99,235,0.18)] bg-info-soft/80",
    dot: "bg-info-indicator",
    label: "Requested",
  },
  done: {
    surface: "border-[rgba(13,47,66,0.10)] bg-surface-muted",
    dot: "bg-neutral-indicator",
    label: "Completed",
  },
  cancelled: {
    surface: "border-[rgba(13,47,66,0.10)] bg-surface-muted",
    dot: "bg-neutral-indicator",
    label: "Cancelled",
  },
};

function shiftTone(shift: ShiftListItem): BlockTone {
  if (shift.status === "cancelled") return "cancelled";
  if (shift.status === "completed") return "done";
  if (shift.status === "draft" || shift.status === "submitted") return "requested";
  return "open";
}

function assignmentTone(shift: ShiftListItem, assignment: ShiftAssignment): BlockTone {
  if (shift.status === "cancelled") return "cancelled";
  if (shift.status === "completed") return "done";
  return assignment.status === "accepted" ? "confirmed" : "pending";
}

/** Short facility label for a compact block ("Riverside Medical Center" → "Riverside MC"). */
function shortFacility(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return name;
  return `${words[0]} ${words
    .slice(1)
    .map((word) => word.charAt(0).toUpperCase())
    .join("")}`;
}

const dayHeader = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });
const dayDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});
const dayLong = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long",
  month: "short",
  day: "numeric",
});
const rangeLabel = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDaysIso(iso: string, days: number): string {
  const date = utc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Monday of the week containing `iso` (ISO week). */
export function weekStartOf(iso: string): string {
  const date = utc(iso);
  const isoDow = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  return addDaysIso(iso, 1 - isoDow);
}

type Entry = { shift: ShiftListItem; tone: BlockTone; worker: string | null };

function Block({
  entry,
  renderDetails,
  compact,
}: {
  entry: Entry;
  renderDetails: (shift: ShiftListItem) => ReactNode;
  compact: boolean;
}) {
  const { shift, tone, worker } = entry;
  const style = BLOCK[tone];
  const { range } = formatShiftTimeRangeParts(shift);
  return (
    <DetailDrawerTrigger
      triggerLabel={
        <span className="flex w-full min-w-0 flex-col items-start gap-0.5 text-left">
          <span className="flex w-full min-w-0 items-start gap-1.5">
            <span
              aria-hidden="true"
              className={cn("mt-[3px] size-2 shrink-0 rounded-full", style.dot)}
            />
            <span className="text-[11px] leading-[14px] font-semibold tracking-[-0.01em] text-chelth-navy">
              {compact ? range.replace(" – ", "–") : range}
            </span>
          </span>
          <span className="w-full truncate pl-3.5 text-[11px] leading-4 text-slate-600">
            {compact ? shortFacility(shift.facilityName) : shift.facilityName}
            {!compact && worker ? ` · ${worker}` : ""}
          </span>
        </span>
      }
      triggerAccessibleLabel={`Details for ${shift.facilityName} · ${shift.disciplineName} · ${formatShiftDate(shift)}${worker ? ` · ${worker}` : ""} · ${style.label}`}
      triggerClassName={cn(
        "w-full rounded-[8px] border px-2 py-1.5 no-underline transition-[filter] hover:brightness-[0.97] sm:min-h-0",
        style.surface,
      )}
      title="Shift Details"
      width="profile"
    >
      {renderDetails(shift)}
    </DetailDrawerTrigger>
  );
}

export function ShiftCalendar({
  shifts,
  assignmentsOf,
  canSeeAssignments,
  weekStart,
  today,
  hrefFor,
  renderDetails,
}: {
  shifts: ShiftListItem[];
  /** Active assignments per shift (empty when not visible to the caller). */
  assignmentsOf: (shiftId: string) => ShiftAssignment[];
  canSeeAssignments: boolean;
  weekStart: string;
  today: string;
  /** Calendar URL for another week (keeps the other filters). */
  hrefFor: (week: string | null) => Route;
  renderDetails: (shift: ShiftListItem) => ReactNode;
}) {
  const days = Array.from({ length: 7 }, (_, index) => addDaysIso(weekStart, index));
  const dayOf = (shift: ShiftListItem) => localDate(shift.startAt, shift.timezone);

  // Rows: each assigned worker; then open places (and shifts not yet open).
  const staff = new Map<string, { name: string; entries: Entry[]; hours: number }>();
  const openRow: Entry[] = [];
  for (const shift of shifts) {
    const active = canSeeAssignments ? assignmentsOf(shift.id) : [];
    for (const assignment of active) {
      const row = staff.get(assignment.workerId) ?? {
        name: assignment.workerName,
        entries: [],
        hours: 0,
      };
      row.entries.push({
        shift,
        tone: assignmentTone(shift, assignment),
        worker: assignment.workerName,
      });
      row.hours += shiftDurationHours(shift);
      staff.set(assignment.workerId, row);
    }
    const needsStaff =
      shift.status === "draft" ||
      shift.status === "submitted" ||
      (shift.status === "open" && shift.activeCount < shift.requestedHeadcount);
    if (!canSeeAssignments || needsStaff || (active.length === 0 && shift.status !== "open")) {
      openRow.push({ shift, tone: shiftTone(shift), worker: null });
    }
  }
  const staffRows = [...staff.entries()]
    .map(([workerId, row]) => ({ workerId, ...row }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const rows: { key: string; label: ReactNode; entries: Entry[] }[] = [
    ...(openRow.length > 0
      ? [
          {
            key: "open",
            label: (
              <span className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger-indicator [&>svg]:size-4"
                >
                  <WorkspaceNavIcon name="shifts" strokeWidth={2.1} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[12.5px] font-semibold text-chelth-navy">
                    {canSeeAssignments ? "Open places" : "All shifts"}
                  </span>
                  <span className="text-[11px] text-slate-600">
                    {openRow.length} {openRow.length === 1 ? "shift" : "shifts"}
                  </span>
                </span>
              </span>
            ),
            entries: openRow,
          },
        ]
      : []),
    ...staffRows.map((row) => ({
      key: row.workerId,
      label: (
        <span className="flex items-center gap-2.5">
          <InitialsAvatar name={row.name} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[12.5px] font-semibold text-chelth-navy">
              {row.name}
            </span>
            <span className="text-[11px] text-slate-600">
              {Math.round(row.hours * 10) / 10} hrs
            </span>
          </span>
        </span>
      ),
      entries: row.entries,
    })),
  ];
  const entriesOn = (entries: Entry[], day: string) =>
    entries
      .filter((entry) => dayOf(entry.shift) === day)
      .sort((a, b) => a.shift.startAt.localeCompare(b.shift.startAt));
  const weekTitle = `${rangeLabel.format(utc(days[0] ?? weekStart)).replace(/, \d{4}$/, "")} – ${rangeLabel.format(utc(days[6] ?? weekStart))}`;
  const thisWeek = weekStartOf(today);

  return (
    <section
      aria-labelledby="shift-calendar-heading"
      className={cn(REF_CARD, "flex flex-col overflow-hidden")}
    >
      {/* Reference calendar toolbar: previous / Today / next and the week range. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-chelth-border/55 px-[15px] py-3">
        <nav aria-label="Calendar week" className="flex items-center gap-2">
          <Link
            href={hrefFor(addDaysIso(weekStart, -7))}
            className="inline-flex size-11 items-center justify-center rounded-md border border-chelth-border bg-white text-chelth-navy hover:bg-surface-muted sm:size-10"
          >
            <span aria-hidden="true">‹</span>
            <span className="sr-only">Previous week</span>
          </Link>
          <Link
            href={hrefFor(null)}
            aria-current={weekStart === thisWeek ? "page" : undefined}
            className="inline-flex h-11 items-center rounded-md border border-chelth-border bg-white px-4 text-[13.5px] font-medium text-chelth-navy hover:bg-surface-muted sm:h-10"
          >
            Today
          </Link>
          <Link
            href={hrefFor(addDaysIso(weekStart, 7))}
            className="inline-flex size-11 items-center justify-center rounded-md border border-chelth-border bg-white text-chelth-navy hover:bg-surface-muted sm:size-10"
          >
            <span aria-hidden="true">›</span>
            <span className="sr-only">Next week</span>
          </Link>
        </nav>
        <h2
          id="shift-calendar-heading"
          className="font-display text-[18px] leading-6 font-semibold tracking-[-0.02em] text-chelth-navy"
        >
          {weekTitle}
        </h2>
        {/* Week view only (no Day / Month view exists): stated, not a fake selector. */}
        <span className="text-[12.5px] font-medium text-slate-600">Week view</span>
      </div>

      {shifts.length === 0 ? (
        <div className="flex items-center gap-3 px-[15px] py-5">
          <span
            aria-hidden="true"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-muted text-muted-foreground [&>svg]:size-[19px]"
          >
            <WorkspaceNavIcon name="shifts" strokeWidth={2} />
          </span>
          <span className="flex flex-col">
            <span className="text-[14px] leading-5 font-medium text-slate-600">
              No shifts this week.
            </span>
            <span className="text-[12.5px] leading-[18px] text-muted-foreground">
              Choose another week or change the filters.
            </span>
          </span>
        </div>
      ) : (
        <>
          {/* Desktop: the reference week grid (scrolls inside its region if narrow). */}
          <DataTableRegion
            aria-label="Weekly shift calendar"
            className="hidden rounded-none border-0 bg-transparent lg:block"
          >
            <table className="w-full min-w-[920px] table-fixed border-separate border-spacing-0 text-left">
              <caption className="sr-only">
                Shifts for the week of {weekTitle}, by staff member and day
              </caption>
              <colgroup>
                <col className="w-[160px]" />
                {days.map((day) => (
                  <col key={day} />
                ))}
              </colgroup>
              <thead>
                <tr className="[&>th]:h-[52px] [&>th]:border-b [&>th]:border-chelth-border/55 [&>th]:px-2 [&>th]:align-middle">
                  <th scope="col" className="px-[15px]! text-[14px] font-semibold text-chelth-navy">
                    {canSeeAssignments ? `Staff (${staffRows.length})` : "Shifts"}
                  </th>
                  {days.map((day) => (
                    <th
                      key={day}
                      scope="col"
                      aria-current={day === today ? "date" : undefined}
                      className={cn(
                        "text-center text-[12px] leading-4 font-semibold text-chelth-navy",
                        day === today && "bg-chelth-mint-mist/70 text-chelth-teal-dark",
                      )}
                    >
                      <span className="block">{dayHeader.format(utc(day))}</span>
                      <span className="block font-normal text-slate-600">
                        {dayDate.format(utc(day))}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.key}
                    className="[&>td]:border-b [&>td]:border-chelth-border/45 [&>td]:p-1.5 [&>td]:align-top"
                  >
                    <th
                      scope="row"
                      className="border-b border-chelth-border/45 px-[15px] py-2 text-left align-middle font-normal"
                    >
                      {row.label}
                    </th>
                    {days.map((day) => {
                      const items = entriesOn(row.entries, day);
                      return (
                        <td key={day} className={cn(day === today && "bg-chelth-mint-mist/30")}>
                          {items.length === 0 ? (
                            <span
                              aria-hidden="true"
                              className="block py-2 text-center text-slate-400"
                            >
                              —
                            </span>
                          ) : (
                            <ul className="flex flex-col gap-1.5">
                              {items.map((entry) => (
                                <li key={`${entry.shift.id}-${entry.worker ?? "open"}`}>
                                  <Block entry={entry} renderDetails={renderDetails} compact />
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTableRegion>

          {/* Phones and tablets: the same week as a day-by-day agenda. */}
          <ol aria-label="Weekly shift agenda" className="flex flex-col lg:hidden">
            {days.map((day) => {
              const items = rows.flatMap((row) => entriesOn(row.entries, day));
              if (items.length === 0) return null;
              return (
                <li
                  key={day}
                  className="border-b border-chelth-border/45 px-[15px] py-3 last:border-b-0"
                >
                  <h3
                    className={cn(
                      "mb-2 text-[13.5px] font-semibold text-chelth-navy",
                      day === today && "text-chelth-teal-dark",
                    )}
                  >
                    {dayLong.format(utc(day))}
                    {day === today ? " · Today" : ""}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {items.map((entry) => (
                      <li key={`${entry.shift.id}-${entry.worker ?? "open"}`}>
                        <Block entry={entry} renderDetails={renderDetails} compact={false} />
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {/* Status legend (text, not colour alone). */}
      <ul
        aria-label="Calendar status key"
        className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-chelth-border/45 px-[15px] py-2.5 text-[12px] text-slate-600"
      >
        {(["confirmed", "pending", "open", "requested", "done"] as const).map((tone) => (
          <li key={tone} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn("size-2 rounded-full", BLOCK[tone].dot)} />
            {BLOCK[tone].label}
          </li>
        ))}
      </ul>
    </section>
  );
}
