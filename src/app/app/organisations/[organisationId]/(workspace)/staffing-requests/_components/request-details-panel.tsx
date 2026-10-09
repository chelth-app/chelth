import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { DetailsTabs } from "@/components/reference/details-tabs";
import { RefChip } from "@/components/reference/locked-reference";
import { KeyValueList } from "@/components/ui/key-value-list";
import { LocationPin } from "@/components/ui/location-pin";
import { FILL_TONE, type listFacilityShifts, SHIFT_TONE } from "@/features/shifts";
import {
  FILL_STATE_LABELS,
  formatShiftDate,
  formatShiftTimeRange,
  SHIFT_CANCELLATION_REASON_LABELS,
  SHIFT_SOURCE_LABELS,
  SHIFT_STATUS_LABELS,
} from "@/lib/domain/shifts";
import { RELATIONSHIP_STATUS_LABELS } from "@/lib/domain/vocabulary";
import { cn } from "@/lib/utils/cn";

import { INK } from "../../(finance)/_components/finance-locked";

/** A row of the facility's own shift projection (no worker names, pay or coordinates). */
export type FacilityRequest = Awaited<ReturnType<typeof listFacilityShifts>>[number];

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
 * Request Details — the canonical Chelth drawer (CHELTH-LOCKED-VISUAL-SYSTEM.md,
 * C) with the facility's request content (P0-E8-QA-F1). Every fact comes from
 * the facility shift projection already loaded for the list row; who is coming
 * and attendance stay on the request record, whose reads are audited.
 */
export function RequestDetailsPanel({ shift, href }: { shift: FacilityRequest; href: Route }) {
  const id = `request-${shift.id}`;
  const open = shift.status === "open";

  const overview = (
    <Section id={`${id}-overview`} title="Request Details" divided={false}>
      <KeyValueList
        className="sm:grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] sm:gap-x-5"
        items={[
          { label: "Agency", value: shift.agencyName },
          { label: "Location", value: shift.locationName },
          { label: "Date", value: formatShiftDate(shift) },
          { label: "Time", value: formatShiftTimeRange(shift) },
          { label: "Timezone", value: shift.timezone },
          { label: "Source", value: SHIFT_SOURCE_LABELS[shift.source] },
          ...(shift.externalReference
            ? [{ label: "Reference", value: shift.externalReference }]
            : []),
          ...(shift.cancellationReason
            ? [
                {
                  label: "Cancelled",
                  value: SHIFT_CANCELLATION_REASON_LABELS[shift.cancellationReason],
                },
              ]
            : []),
        ]}
      />
    </Section>
  );

  const staffing = (
    <div className="flex flex-col">
      <Section id={`${id}-staffing`} title="Staffing Status" divided={false}>
        <KeyValueList
          className="sm:grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] sm:gap-x-5"
          items={[
            {
              label: "Status",
              value: (
                <RefChip tone={SHIFT_TONE[shift.status]} className="font-semibold">
                  {SHIFT_STATUS_LABELS[shift.status]}
                </RefChip>
              ),
            },
            ...(open
              ? [
                  {
                    label: "Staffing",
                    value: (
                      <RefChip tone={FILL_TONE[shift.fillState]} className="font-semibold">
                        {FILL_STATE_LABELS[shift.fillState]} · {shift.activeCount} of{" "}
                        {shift.requestedHeadcount}
                      </RefChip>
                    ),
                  },
                ]
              : []),
            {
              label: "Workers needed",
              value: `${shift.requestedHeadcount} (${shift.acceptedCount} confirmed)`,
            },
          ]}
        />
      </Section>
      <Section id={`${id}-relationship`} title="Agency Relationship">
        <KeyValueList
          className="sm:grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] sm:gap-x-5"
          items={[
            { label: "Agency", value: shift.agencyName },
            {
              label: "Relationship",
              value: RELATIONSHIP_STATUS_LABELS[shift.relationshipStatus],
            },
          ]}
        />
        <p className="text-[12.5px] leading-[18px] text-slate-600">
          Who is coming and attendance are on the request page.
        </p>
      </Section>
    </div>
  );

  return (
    <div className="flex min-h-full flex-col text-[13.5px] leading-5">
      {/* Identity: request tile, role, date and time, agency and location, status. */}
      <div className="flex items-start gap-4 pt-1">
        <span
          aria-hidden="true"
          className="inline-flex size-[84px] shrink-0 items-center justify-center rounded-[14px] bg-[radial-gradient(circle_at_30%_25%,#f4fdfa_0%,#d3f2e8_45%,#a9e3d3_100%)] text-chelth-teal-dark shadow-[0_6px_16px_rgba(0,90,96,0.18),inset_0_1px_0_rgba(255,255,255,0.9)] ring-4 ring-white [&>svg]:size-10"
        >
          <WorkspaceNavIcon name="requests" strokeWidth={1.9} duotone />
        </span>
        <div className="flex min-w-0 flex-1 flex-col pt-1">
          <p
            className={cn(
              "font-display text-[21px] leading-[27px] font-bold tracking-[-0.02em]",
              INK,
            )}
          >
            {shift.disciplineName}
          </p>
          <p className="text-[14.5px] leading-[22px] font-medium text-slate-600">
            {formatShiftDate(shift)} · {formatShiftTimeRange(shift)}
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[13.5px] text-slate-600">
              <LocationPin className="size-4 shrink-0 text-chelth-teal-dark" />
              <span className="truncate">
                {shift.agencyName} · {shift.locationName}
              </span>
            </span>
            {open ? (
              <RefChip
                tone={FILL_TONE[shift.fillState]}
                className="h-7 px-3 text-[12.5px] font-semibold"
              >
                {FILL_STATE_LABELS[shift.fillState]} · {shift.activeCount} of{" "}
                {shift.requestedHeadcount}
              </RefChip>
            ) : (
              <RefChip
                tone={SHIFT_TONE[shift.status]}
                className="h-7 px-3 text-[12.5px] font-semibold"
              >
                {SHIFT_STATUS_LABELS[shift.status]}
              </RefChip>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <DetailsTabs
          label={`${shift.disciplineName} request`}
          tabs={[
            { id: "overview", label: "Overview", content: overview },
            { id: "staffing", label: "Staffing", content: staffing },
          ]}
        />
      </div>

      {/* Locked action region: the request record is the one real destination. */}
      <div className="mt-auto flex flex-col gap-2.5 pt-4">
        <Link
          href={href}
          className="inline-flex h-12 items-center justify-center gap-2.5 rounded-[8px] bg-[linear-gradient(180deg,#00666c,#004f55)] text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_14px_-4px_rgba(0,58,64,0.45)] transition-[filter] hover:brightness-110"
        >
          <WorkspaceNavIcon name="requests" strokeWidth={2.1} className="size-5" />
          Open request
        </Link>
      </div>
    </div>
  );
}
