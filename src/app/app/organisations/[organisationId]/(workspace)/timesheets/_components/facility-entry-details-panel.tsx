import type { ReactNode } from "react";

import { DetailsTabs } from "@/components/reference/details-tabs";
import { InitialsAvatar, RefChip } from "@/components/reference/locked-reference";
import { KeyValueList } from "@/components/ui/key-value-list";
import { LocationPin } from "@/components/ui/location-pin";
import type { StatusTone } from "@/components/ui/status-chip";
import type { listFacilityTimesheetEntries } from "@/features/timesheets";
import { formatLocalClockTime } from "@/lib/domain/attendance";
import { formatShiftDate, formatShiftTimeRange } from "@/lib/domain/shifts";
import {
  DISPUTE_REASON_LABELS,
  FACILITY_STATE_LABELS,
  formatWorkedMinutes,
  type TimesheetFacilityState,
} from "@/lib/domain/timesheets";
import { cn } from "@/lib/utils/cn";

import { INK } from "../../(finance)/_components/finance-locked";

/** A row of the facility's own sign-off projection (no pay, rates or coordinates). */
export type FacilityEntry = Awaited<ReturnType<typeof listFacilityTimesheetEntries>>[number];

export const FACILITY_STATE_TONE: Record<TimesheetFacilityState, StatusTone> = {
  not_required: "info",
  pending: "info",
  signed_off: "success",
  disputed: "danger",
};

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
 * Timesheet Details for the facility (P0-E8-QA-F1): the canonical record-detail
 * drawer (Timesheet Details anatomy) over the facility's sign-off projection
 * only. Sign-off and discrepancy decisions stay on the table's existing forms.
 */
export function FacilityEntryDetailsPanel({ entry }: { entry: FacilityEntry }) {
  const id = `facility-entry-${entry.id}`;
  const shift = {
    startAt: entry.scheduledStartAt,
    endAt: entry.scheduledEndAt,
    timezone: entry.timezone,
  };
  const worker = entry.workerName ?? "Worker";

  const overview = (
    <Section id={`${id}-time`} title="Time Details" divided={false}>
      <KeyValueList
        className="sm:grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] sm:gap-x-5"
        items={[
          { label: "Scheduled", value: formatShiftTimeRange(shift) },
          {
            label: "Worked from – to",
            value: `${formatLocalClockTime(entry.effectiveStartAt, entry.timezone)} – ${formatLocalClockTime(entry.effectiveEndAt, entry.timezone)}`,
          },
          { label: "Breaks", value: formatWorkedMinutes(entry.breakMinutes) },
          { label: "Worked", value: formatWorkedMinutes(entry.workedMinutes) },
          { label: "Timezone", value: entry.timezone },
          { label: "Agency", value: entry.agencyName },
          { label: "Location", value: `${entry.facilityName} · ${entry.locationName}` },
        ]}
      />
    </Section>
  );

  const signoff = (
    <Section id={`${id}-signoff`} title="Facility Sign-off" divided={false}>
      <KeyValueList
        className="sm:grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] sm:gap-x-5"
        items={[
          {
            label: "Sign-off",
            value: (
              <RefChip tone={FACILITY_STATE_TONE[entry.facilityState]} className="font-semibold">
                {FACILITY_STATE_LABELS[entry.facilityState]}
              </RefChip>
            ),
          },
          ...(entry.facilityState === "disputed" && entry.disputeReason
            ? [{ label: "Discrepancy", value: DISPUTE_REASON_LABELS[entry.disputeReason] }]
            : []),
          { label: "Revision", value: entry.revision },
        ]}
      />
      <p className="text-[12.5px] leading-[18px] text-slate-600">
        Sign off or raise a discrepancy from the table. You cannot change times here.
      </p>
    </Section>
  );

  return (
    <div className="flex min-h-full flex-col text-[13.5px] leading-5">
      {/* Identity: worker, record type, date, agency and location, sign-off state. */}
      <div className="flex items-start gap-4 pt-1">
        <span className="rounded-full shadow-[0_6px_16px_rgba(0,90,96,0.18)] ring-4 ring-white">
          <InitialsAvatar name={entry.workerName} size={84} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col pt-1">
          <p
            className={cn(
              "font-display text-[21px] leading-[27px] font-bold tracking-[-0.02em]",
              INK,
            )}
          >
            {worker}
          </p>
          <p className="text-[14px] leading-5 font-medium text-slate-600">
            Timesheet entry · {entry.agencyName}
          </p>
          <p className="text-[13px] leading-[18px] text-muted-foreground">
            {formatShiftDate(shift)}
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[13.5px] text-slate-600">
              <LocationPin className="size-4 shrink-0 text-chelth-teal-dark" />
              <span className="truncate">
                {entry.facilityName} · {entry.locationName}
              </span>
            </span>
            <RefChip
              tone={FACILITY_STATE_TONE[entry.facilityState]}
              className="h-7 px-3 text-[12.5px] font-semibold"
            >
              {FACILITY_STATE_LABELS[entry.facilityState]}
            </RefChip>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <DetailsTabs
          label={`${worker} timesheet entry`}
          tabs={[
            { id: "overview", label: "Overview", content: overview },
            { id: "signoff", label: "Sign-off", content: signoff },
          ]}
        />
      </div>
    </div>
  );
}
