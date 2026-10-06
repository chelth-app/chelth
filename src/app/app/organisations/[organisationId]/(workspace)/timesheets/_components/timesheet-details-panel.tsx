import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { DetailsTabs } from "@/components/reference/details-tabs";
import { InitialsAvatar, RefChip } from "@/components/reference/locked-reference";
import { ActivityTimeline } from "@/components/ui/activity-timeline";
import { type KeyValueItem, KeyValueList } from "@/components/ui/key-value-list";
import { LocationPin } from "@/components/ui/location-pin";
import type {
  AgencyTimesheetRow,
  TimesheetEntryRow,
  TimesheetHistoryRow,
} from "@/features/timesheets";
import { formatLocalClockTime } from "@/lib/domain/attendance";
import { formatShiftDate } from "@/lib/domain/shifts";
import {
  blockingReasonLabel,
  FACILITY_STATE_LABELS,
  formatPeriod,
  formatWorkedMinutes,
  HISTORY_ACTION_LABELS,
  TIMESHEET_STATUS_LABELS,
  type TimesheetFacilityState,
} from "@/lib/domain/timesheets";
import { cn } from "@/lib/utils/cn";

import { activityWhen, reasonLabel } from "./history-format";
import { FACILITY_STATE_TONE, HISTORY_TONE, TIMESHEET_TONE } from "./timesheet-tones";

/*
 * Timesheet Details — the canonical Chelth drawer (CHELTH-LOCKED-VISUAL-
 * SYSTEM.md, C) with timesheet content. Every time value is derived from
 * attendance by the database; this panel only formats it. Decisions stay on
 * the timesheet record, through the existing approval forms.
 */

const INK = "text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]";

function Section({
  id,
  title,
  children,
  divided = true,
}: {
  id: string;
  title: string;
  children: ReactNode;
  divided?: boolean;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "flex flex-col gap-2.5 py-3.5",
        divided && "border-t border-[rgba(18,107,103,0.12)]",
      )}
    >
      <h3 id={id} className={cn("text-[16px] leading-[22px] font-semibold", INK)}>
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Time Details uses the canonical record-page label/value list (KeyValueList:
 * labels 500 slate-600, values 500 heading ink), as Worker and Facility Record.
 */
function Facts({ items }: { items: KeyValueItem[] }) {
  return (
    <KeyValueList
      items={items}
      className="sm:grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] sm:gap-x-5"
    />
  );
}

/** Quiet note row (neutral tile), as the drawer empty states. */
function QuietNote({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-center gap-3">
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

export type TimesheetDetails = {
  entries: TimesheetEntryRow[];
  history: TimesheetHistoryRow[];
};

export function TimesheetDetailsPanel({
  row,
  details,
  recordHref,
  reviewHref,
  attendanceHref,
  attendanceRecordHref,
  shiftsHref,
}: {
  row: AgencyTimesheetRow;
  /** Entries and history, loaded for the listed timesheets (null: open the record). */
  details: TimesheetDetails | null;
  recordHref: Route;
  /** Set when the viewer can approve and the timesheet is waiting for review. */
  reviewHref: Route | null;
  /** The attendance window for this week (attendance.view holders only). */
  attendanceHref: Route | null;
  attendanceRecordHref: ((attendanceId: string) => Route) | null;
  /** The exact shift when the week has one, else the week in Shifts (shift.view holders only). */
  shiftsHref: { href: Route; label: string } | null;
}) {
  const id = `timesheet-${row.id}`;
  const worker = row.workerName ?? "Worker";
  const tone = TIMESHEET_TONE[row.status];
  const entries = details?.entries.filter((entry) => entry.included) ?? [];
  const breakMinutes = entries.reduce((sum, entry) => sum + (entry.breakMinutes ?? 0), 0);
  const adjustments = entries.reduce((sum, entry) => sum + entry.approvedCorrections, 0);
  const toResolve = entries.filter(
    (entry) => entry.blockingReasons.length > 0 || entry.openExceptionTypes.length > 0,
  );
  const signoffStates = (Object.keys(FACILITY_STATE_LABELS) as TimesheetFacilityState[])
    .map((state) => ({
      state,
      count: entries.filter((entry) => entry.facilityState === state).length,
    }))
    .filter((item) => item.count > 0);
  const approved = row.status === "agency_approved" || row.status === "locked";
  // Newest first; the record keeps the full append-only history.
  const history = [...(details?.history ?? [])].sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt),
  );

  const statusChip = (
    <RefChip tone={tone} className="font-semibold">
      {TIMESHEET_STATUS_LABELS[row.status]}
    </RefChip>
  );

  const timeDetails = (
    <Section id={`${id}-time`} title="Time Details" divided={false}>
      <Facts
        items={[
          { label: "Week", value: formatPeriod(row.periodStart, row.periodEnd) },
          { label: "Shifts", value: <span className="tabular-nums">{row.entryCount}</span> },
          ...(details
            ? [
                {
                  label: "Break deduction",
                  value: (
                    <span className="tabular-nums">
                      {breakMinutes > 0 ? formatWorkedMinutes(breakMinutes) : "None"}
                    </span>
                  ),
                },
              ]
            : []),
          {
            label: "Worked hours",
            value: (
              <span className="tabular-nums">{formatWorkedMinutes(row.totalWorkedMinutes)}</span>
            ),
          },
          {
            label: "Source",
            value: (
              <RefChip tone="info" className="font-semibold">
                Attendance (derived)
              </RefChip>
            ),
          },
          ...(details
            ? [
                {
                  label: "Adjustments",
                  value:
                    adjustments === 0
                      ? "—"
                      : adjustments === 1
                        ? "1 approved correction"
                        : `${adjustments} approved corrections`,
                },
              ]
            : []),
          { label: "Approval status", value: statusChip },
          {
            label: "Revision",
            value: row.revision > 1 ? `Revision ${row.revision} (current)` : "First revision",
          },
        ]}
      />
    </Section>
  );

  const verification = (
    <Section id={`${id}-verification`} title="Attendance Verification">
      {!details ? (
        row.issueCount === 0 ? (
          <VerificationNote
            tone="success"
            title="No shifts to resolve"
            note="Worked time comes only from clock events and approved corrections."
          />
        ) : (
          <VerificationNote
            tone="warning"
            title={
              row.issueCount === 1 ? "1 shift to resolve" : `${row.issueCount} shifts to resolve`
            }
            note="Open the timesheet record to see what each shift needs."
          />
        )
      ) : toResolve.length === 0 ? (
        <VerificationNote
          tone="success"
          title="Times come from attendance records"
          note="Check-in and check-out times are taken from clock events and approved corrections; they cannot be typed in."
        />
      ) : (
        <>
          <VerificationNote
            tone="warning"
            title={
              toResolve.length === 1
                ? "1 shift to resolve"
                : `${toResolve.length} shifts to resolve`
            }
            note="Resolve these in Attendance; the timesheet updates from the attendance record."
          />
          <ul className="flex flex-col divide-y divide-[rgba(18,107,103,0.10)]">
            {toResolve.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 py-2">
                <span className="text-[13.5px] font-medium text-chelth-navy">
                  {formatShiftDate({ startAt: entry.scheduledStartAt, timezone: entry.timezone })} ·{" "}
                  {entry.facilityName}
                </span>
                <span className="text-[12.5px] text-slate-600">
                  {[
                    ...entry.blockingReasons.map(blockingReasonLabel),
                    ...(entry.openExceptionTypes.length > 0 ? ["Exception to review"] : []),
                  ].join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );

  const signoff =
    approved && details ? (
      <Section id={`${id}-signoff`} title="Facility Sign-off">
        {signoffStates.length === 0 ? (
          <QuietNote title="No entries" note="Nothing in this week needs facility sign-off." />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {signoffStates.map((item) => (
              <li key={item.state}>
                <RefChip tone={FACILITY_STATE_TONE[item.state]} className="font-semibold">
                  {item.count} · {FACILITY_STATE_LABELS[item.state]}
                </RefChip>
              </li>
            ))}
          </ul>
        )}
      </Section>
    ) : approved && (row.pendingFacilityCount > 0 || row.disputedCount > 0) ? (
      <Section id={`${id}-signoff`} title="Facility Sign-off">
        <ul className="flex flex-wrap gap-2">
          {row.pendingFacilityCount > 0 ? (
            <li>
              <RefChip tone="info" className="font-semibold">
                {row.pendingFacilityCount} · {FACILITY_STATE_LABELS.pending}
              </RefChip>
            </li>
          ) : null}
          {row.disputedCount > 0 ? (
            <li>
              <RefChip tone="danger" className="font-semibold">
                {row.disputedCount} · {FACILITY_STATE_LABELS.disputed}
              </RefChip>
            </li>
          ) : null}
        </ul>
      </Section>
    ) : null;

  const audit = (limit: number | null, divided: boolean, sectionId: string) => (
    <Section id={sectionId} title="Audit History" divided={divided}>
      {!details ? (
        <QuietNote
          title="History is on the timesheet record"
          note="Every submission, decision and revision is kept there."
        />
      ) : history.length === 0 ? (
        <QuietNote title="Nothing has happened yet" note="Events appear here as they happen." />
      ) : (
        <ActivityTimeline
          label={`${worker} timesheet history`}
          items={(limit ? history.slice(0, limit) : history).map((item, index) => ({
            id: `${item.action}-${item.occurredAt}-${index}`,
            tone: HISTORY_TONE[item.action],
            title: (
              <>
                {HISTORY_ACTION_LABELS[item.action]}
                {item.revision > 1 ? (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · Revision {item.revision}
                  </span>
                ) : null}
              </>
            ),
            meta: (
              <>
                <time dateTime={item.occurredAt} className="tabular-nums">
                  {activityWhen.format(new Date(item.occurredAt))}
                </time>
                {reasonLabel(item.reasonCode) ? ` · ${reasonLabel(item.reasonCode)}` : ""}
                {item.actorName ? ` · ${item.actorName}` : ""}
              </>
            ),
          }))}
        />
      )}
      {details && limit && history.length > limit ? (
        <Link
          href={`${recordHref}#timesheet-history-heading` as Route}
          className="w-fit text-[12.5px] font-semibold text-primary underline underline-offset-4"
        >
          Full history ({history.length} events)
        </Link>
      ) : null}
    </Section>
  );

  const shifts = (
    <Section id={`${id}-shifts`} title="Shifts This Week" divided={false}>
      {!details ? (
        <QuietNote
          title="Shifts are on the timesheet record"
          note="Open the record for each shift's clock times."
        />
      ) : entries.length === 0 ? (
        <QuietNote title="No work in this week" note="Shifts appear once attendance exists." />
      ) : (
        <ul className="flex flex-col divide-y divide-[rgba(18,107,103,0.10)]">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 py-2.5">
              <span
                aria-hidden="true"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[linear-gradient(145deg,#e6f9f3,#ccefe3)] text-chelth-teal-dark [&>svg]:size-[18px]"
              >
                <WorkspaceNavIcon name="shifts" strokeWidth={2.1} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13.5px] leading-5 font-medium text-chelth-navy">
                  {formatShiftDate({ startAt: entry.scheduledStartAt, timezone: entry.timezone })}
                </span>
                <span className="truncate text-[12.5px] leading-[18px] text-slate-600">
                  {entry.facilityName} ·{" "}
                  {entry.notWorked
                    ? "Not worked"
                    : `${formatLocalClockTime(entry.effectiveStartAt, entry.timezone)} – ${formatLocalClockTime(entry.effectiveEndAt, entry.timezone)}`}
                </span>
                {attendanceRecordHref && entry.attendanceId ? (
                  <Link
                    href={attendanceRecordHref(entry.attendanceId)}
                    className="w-fit text-[12.5px] font-semibold text-primary underline underline-offset-4"
                  >
                    Attendance record
                  </Link>
                ) : null}
              </span>
              <span className="text-[13.5px] font-medium text-chelth-navy tabular-nums">
                {entry.notWorked ? "—" : formatWorkedMinutes(entry.workedMinutes)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );

  const tabs = [
    {
      id: "overview",
      label: "Overview",
      content: (
        <div className="flex flex-col">
          {timeDetails}
          {verification}
          {signoff}
          {audit(3, true, `${id}-audit`)}
        </div>
      ),
    },
    { id: "shifts", label: "Shifts", content: shifts },
    {
      id: "history",
      label: "History",
      content: audit(null, false, `${id}-audit-all`),
    },
  ];

  const secondary = [
    ...(attendanceHref
      ? [{ href: attendanceHref, label: "View Attendance", icon: "attendance" as const }]
      : []),
    ...(shiftsHref ? [{ ...shiftsHref, icon: "shifts" as const }] : []),
  ];

  return (
    <div className="flex min-h-full flex-col text-[13.5px] leading-5">
      <div className="flex items-start gap-4 pt-1">
        <span className="rounded-full shadow-[0_6px_16px_rgba(0,90,96,0.18)] ring-4 ring-white">
          <InitialsAvatar name={row.workerName} size={84} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col pt-2">
          <div className="flex items-start justify-between gap-2">
            <p
              className={cn(
                "font-display text-[21px] leading-[27px] font-bold tracking-[-0.02em]",
                INK,
              )}
            >
              {worker}
            </p>
            <RefChip tone={tone} className="mt-0.5 h-7 shrink-0 px-3 text-[12.5px] font-semibold">
              {TIMESHEET_STATUS_LABELS[row.status]}
            </RefChip>
          </div>
          <p className="truncate text-[14px] leading-[22px] font-medium text-slate-600">
            Weekly timesheet
          </p>
          <p className="truncate text-[13px] leading-5 text-muted-foreground">
            {formatPeriod(row.periodStart, row.periodEnd)}
          </p>
        </div>
      </div>

      <dl className="mt-4 flex flex-col gap-1 text-[14px] text-slate-600">
        <div className="flex min-h-7 items-center gap-3">
          <dt className="flex w-5 justify-center">
            <LocationPin className="size-[18px] text-chelth-teal-dark" />
            <span className="sr-only">Facilities</span>
          </dt>
          <dd className="truncate">
            {row.facilities.length > 0 ? row.facilities.join(", ") : "No facility yet"}
          </dd>
        </div>
        <div className="flex min-h-7 items-center gap-3">
          <dt className="flex w-5 justify-center text-chelth-teal-dark [&>svg]:size-[18px]">
            <WorkspaceNavIcon name="shifts" strokeWidth={2.1} />
            <span className="sr-only">Shifts</span>
          </dt>
          <dd className="truncate">
            {row.entryCount === 1 ? "1 shift" : `${row.entryCount} shifts`} ·{" "}
            {formatWorkedMinutes(row.totalWorkedMinutes)} worked
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <DetailsTabs label={`${worker} timesheet`} tabs={tabs} />
      </div>

      {/* Locked action region: decisions happen on the record, with the existing forms. */}
      <div className="mt-auto flex flex-col gap-2.5 pt-4">
        <Link
          href={reviewHref ?? recordHref}
          className="inline-flex h-12 items-center justify-center gap-2.5 rounded-[8px] bg-[linear-gradient(180deg,#00666c,#004f55)] text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_14px_-4px_rgba(0,58,64,0.45)] transition-[filter] hover:brightness-110"
        >
          <WorkspaceNavIcon name="timesheets" strokeWidth={2.1} className="size-5" />
          {reviewHref ? "Review and approve" : "Open timesheet record"}
        </Link>
        {secondary.length > 0 ? (
          <div className={cn("grid gap-2.5", secondary.length > 1 && "grid-cols-2")}>
            {secondary.map((action) => (
              <Link
                key={action.label}
                href={action.href}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-[rgba(0,90,96,0.35)] bg-white text-[14px] font-semibold text-chelth-navy shadow-[0_1px_2px_rgba(13,47,66,0.05)] hover:border-chelth-teal-dark hover:bg-[#f4fbf9]"
              >
                <WorkspaceNavIcon
                  name={action.icon}
                  strokeWidth={2.1}
                  className="size-[18px] text-chelth-teal-dark"
                />
                {action.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Reference "Attendance Verification" tile: semantic glyph, title and note. */
function VerificationNote({
  tone,
  title,
  note,
}: {
  tone: "success" | "warning";
  title: string;
  note: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[10px] border px-3.5 py-3",
        tone === "success"
          ? "border-[rgba(18,107,103,0.07)] bg-[#f8fcfb]"
          : "border-[rgba(180,120,20,0.10)] bg-warning-soft/40",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-white",
          tone === "success" ? "bg-success-indicator" : "bg-warning-indicator",
        )}
      >
        <svg
          viewBox="0 0 16 16"
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
        >
          {tone === "success" ? (
            <path d="m4 8.5 2.5 2.5L12 5.5" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M8 4.5v4.5M8 11.5v.01" strokeLinecap="round" />
          )}
        </svg>
      </span>
      <span className="flex flex-col">
        <span className="text-[14px] leading-5 font-medium text-chelth-navy">{title}</span>
        <span className="text-[12.5px] leading-[18px] text-slate-600">{note}</span>
      </span>
    </div>
  );
}
