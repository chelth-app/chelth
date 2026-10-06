import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { DetailsTabs } from "@/components/reference/details-tabs";
import { InitialsAvatar, RefChip } from "@/components/reference/locked-reference";
import { LocationPin } from "@/components/ui/location-pin";
import type { StatusTone } from "@/components/ui/status-chip";
import type { AgencyAttendanceRow, OpenException } from "@/features/attendance";
import {
  ATTENDANCE_EXCEPTION_LABELS,
  ATTENDANCE_STATE_LABELS,
  deriveAttendanceState,
  formatLocalClockTime,
  GEOFENCE_RESULT_LABELS,
  type GeofenceResult,
} from "@/lib/domain/attendance";
import { formatShiftDate, formatShiftTimeRangeParts } from "@/lib/domain/shifts";
import { cn } from "@/lib/utils/cn";

import { ATTENDANCE_TONE, GEOFENCE_TONE } from "./attendance-tones";

/*
 * Attendance Details — the canonical Chelth drawer (CHELTH-LOCKED-VISUAL-
 * SYSTEM.md, C) with attendance content. Safe projection only: clock times,
 * derived geofence results, exceptions and pending corrections. Raw
 * coordinates stay on the AAL2-protected evidence route, never here.
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

/** Locked key/value grid for the drawer (label slate, value ink). */
function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[132px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[13.5px] leading-5">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="font-medium text-slate-600">{item.label}</dt>
          <dd className={cn("min-w-0 font-medium", INK)}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function LocationValue({ result }: { result: GeofenceResult | null }) {
  if (!result) return <span className="text-slate-600">—</span>;
  return (
    <RefChip tone={GEOFENCE_TONE[result]} className="font-semibold">
      {GEOFENCE_RESULT_LABELS[result]}
    </RefChip>
  );
}

export function AttendanceDetailsPanel({
  row,
  exceptions,
  recordHref,
  shiftHref,
}: {
  row: AgencyAttendanceRow;
  exceptions: OpenException[];
  recordHref: Route | null;
  shiftHref: Route;
}) {
  const id = `attendance-${row.assignmentId}`;
  const worker = row.workerName ?? "Worker";
  const state = deriveAttendanceState(row.clockState, row.needsReview);
  const tone: StatusTone = ATTENDANCE_TONE[state];
  const { range, zone } = formatShiftTimeRangeParts(row);
  const worked =
    row.clockInAt && row.clockOutAt
      ? Math.max(0, Date.parse(row.clockOutAt) - Date.parse(row.clockInAt)) / 3_600_000
      : null;

  const checkIn = (
    <Section id={`${id}-check-in`} title="Check-In Information" divided={false}>
      <Facts
        items={[
          { label: "Clock-in time", value: formatLocalClockTime(row.clockInAt, row.timezone) },
          { label: "Clock-out time", value: formatLocalClockTime(row.clockOutAt, row.timezone) },
          {
            label: "Time on shift",
            value:
              worked === null ? "—" : `${Math.floor(worked)}h ${Math.round((worked % 1) * 60)}m`,
          },
          {
            label: "Status",
            value: (
              <RefChip tone={tone} className="font-semibold">
                {ATTENDANCE_STATE_LABELS[state]}
              </RefChip>
            ),
          },
          { label: "Location at clock-in", value: <LocationValue result={row.clockInLocation} /> },
          {
            label: "Location at clock-out",
            value: <LocationValue result={row.clockOutLocation} />,
          },
        ]}
      />
    </Section>
  );

  const attention = (
    <Section id={`${id}-attention`} title="Needs Attention">
      {exceptions.length === 0 && row.pendingCorrections === 0 ? (
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-muted text-muted-foreground [&>svg]:size-[19px]"
          >
            <WorkspaceNavIcon name="compliance" strokeWidth={2} />
          </span>
          <span className="flex flex-col">
            <span className="text-[14px] leading-5 font-medium text-slate-600">Nothing open</span>
            <span className="text-[12.5px] leading-[18px] text-muted-foreground">
              Exceptions and correction requests appear here.
            </span>
          </span>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-[rgba(18,107,103,0.10)]">
          {exceptions.map((exception) => (
            <li key={exception.id} className="flex min-h-11 items-center gap-3 py-1.5">
              <RefChip
                tone={exception.severity === "urgent" ? "danger" : "warning"}
                className="font-semibold"
              >
                {ATTENDANCE_EXCEPTION_LABELS[exception.type]}
              </RefChip>
              <span className="text-[12.5px] text-slate-600">
                {exception.status === "under_review" ? "Under review" : "Open"}
              </span>
            </li>
          ))}
          {row.pendingCorrections > 0 ? (
            <li className="flex min-h-11 items-center gap-3 py-1.5">
              <RefChip tone="info" className="font-semibold">
                Correction pending
              </RefChip>
              <span className="text-[12.5px] text-slate-600">
                {row.pendingCorrections} waiting for review
              </span>
            </li>
          ) : null}
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
          {checkIn}
          {attention}
        </div>
      ),
    },
    {
      id: "location",
      label: "Location",
      content: (
        <Section id={`${id}-location`} title="Location Check" divided={false}>
          <Facts
            items={[
              { label: "Site", value: `${row.facilityName} · ${row.locationName}` },
              { label: "At clock-in", value: <LocationValue result={row.clockInLocation} /> },
              { label: "At clock-out", value: <LocationValue result={row.clockOutLocation} /> },
            ]}
          />
          <p className="text-[12.5px] leading-[18px] text-slate-600">
            Only the result is shown here. Location evidence is on the attendance record and
            requires verification with your authenticator app.
          </p>
        </Section>
      ),
    },
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
            <RefChip tone={tone} className="mt-0.5 h-7 px-3 text-[12.5px] font-semibold">
              {ATTENDANCE_STATE_LABELS[state]}
            </RefChip>
          </div>
          <p className="truncate text-[14px] leading-[22px] font-medium text-slate-600">
            {formatShiftDate(row)}
          </p>
        </div>
      </div>

      <dl className="mt-4 flex flex-col gap-1 text-[14px] text-slate-600">
        <div className="flex min-h-7 items-center gap-3">
          <dt className="flex w-5 justify-center">
            <LocationPin className="size-[18px] text-chelth-teal-dark" />
            <span className="sr-only">Facility</span>
          </dt>
          <dd className="truncate">
            {row.facilityName} · {row.locationName}
          </dd>
        </div>
        <div className="flex min-h-7 items-center gap-3">
          <dt className="flex w-5 justify-center text-chelth-teal-dark [&>svg]:size-[18px]">
            <WorkspaceNavIcon name="attendance" strokeWidth={2.1} />
            <span className="sr-only">Shift</span>
          </dt>
          <dd className="truncate">
            {range} <span className="text-muted-foreground">{zone}</span>
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <DetailsTabs label={`${worker} attendance`} tabs={tabs} />
      </div>

      <div className="mt-auto flex flex-col gap-2.5 pt-4">
        {recordHref ? (
          <Link
            href={recordHref}
            className="inline-flex h-12 items-center justify-center gap-2.5 rounded-[8px] bg-[linear-gradient(180deg,#00666c,#004f55)] text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_14px_-4px_rgba(0,58,64,0.45)] transition-[filter] hover:brightness-110"
          >
            <WorkspaceNavIcon name="attendance" strokeWidth={2.1} className="size-5" />
            Open attendance record
          </Link>
        ) : null}
        <Link
          href={shiftHref}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-[rgba(0,90,96,0.35)] bg-white text-[14px] font-semibold text-chelth-navy shadow-[0_1px_2px_rgba(13,47,66,0.05)] hover:border-chelth-teal-dark hover:bg-[#f4fbf9]"
        >
          <WorkspaceNavIcon
            name="shifts"
            strokeWidth={2.1}
            className="size-[18px] text-chelth-teal-dark"
          />
          View Shift
        </Link>
      </div>
    </div>
  );
}
