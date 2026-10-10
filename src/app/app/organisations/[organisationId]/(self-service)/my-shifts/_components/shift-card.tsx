import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import type { MyShiftAssignment } from "@/features/shifts";
import { formatShiftDate, formatShiftTimeRange } from "@/lib/domain/shifts";
import { cn } from "@/lib/utils/cn";

import { FacilityThumb } from "./facility-photo";
import { FactRows, INK, WORKER_CARD, WORKER_PRIMARY_CTA } from "./worker-cards";

/** The worker's shift card (canonical "Next Shift" card): identity, facts, one primary action. */
export function ShiftCard({
  assignment,
  imageUrl,
  href,
  chips,
  actions,
}: {
  assignment: MyShiftAssignment;
  imageUrl: string | null;
  href: string;
  chips: ReactNode;
  actions?: ReactNode;
}) {
  const place = assignment.address?.locality
    ? [assignment.address.locality, assignment.address.region].filter(Boolean).join(", ")
    : assignment.locationName;
  return (
    <li
      aria-label={`${assignment.facilityName} ${formatShiftDate(assignment)}`}
      className={WORKER_CARD}
    >
      <div className="flex items-start gap-3">
        <FacilityThumb url={imageUrl} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className={cn("text-[16px] leading-[22px] font-semibold break-words", INK)}>
            {assignment.facilityName}
          </p>
          <p className="text-[13px] leading-[18px] text-slate-600">{place}</p>
          <div className="mt-0.5 flex flex-wrap gap-1.5">{chips}</div>
        </div>
      </div>
      <FactRows
        rows={[
          { icon: "shifts", label: "Date", value: formatShiftDate(assignment) },
          { icon: "attendance", label: "Time", value: formatShiftTimeRange(assignment) },
          { icon: "workforce", label: "Role", value: assignment.disciplineName },
          ...(assignment.unitLabel
            ? [{ icon: "facilities" as const, label: "Unit", value: assignment.unitLabel }]
            : []),
        ]}
      />
      {actions}
      <Link
        href={href as Route}
        aria-label={`Shift details: ${assignment.facilityName} ${formatShiftDate(assignment)}`}
        className={WORKER_PRIMARY_CTA}
      >
        View Shift Details
      </Link>
    </li>
  );
}

/** Compact row for the upcoming / past lists (canonical "Upcoming Shifts"). */
export function ShiftRow({
  assignment,
  imageUrl,
  href,
  chip,
}: {
  assignment: MyShiftAssignment;
  imageUrl: string | null;
  href: string;
  chip?: ReactNode;
}) {
  return (
    <li className={cn(WORKER_CARD, "relative flex-row items-center gap-3 py-3")}>
      <FacilityThumb url={imageUrl} className="size-14" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link
          href={href as Route}
          aria-label={`Shift details: ${assignment.facilityName} ${formatShiftDate(assignment)}`}
          className={cn(
            "text-[15px] leading-5 font-semibold break-words after:absolute after:inset-0 after:rounded-[14px] after:content-['']",
            INK,
          )}
        >
          {assignment.facilityName}
        </Link>
        <span className="text-[13px] leading-[18px] text-slate-600">
          {formatShiftDate(assignment)}
        </span>
        <span className="text-[13px] leading-[18px] text-slate-600">
          {formatShiftTimeRange(assignment)}
        </span>
        <span className="text-[13px] leading-[18px] text-slate-600">
          {assignment.disciplineName}
          {assignment.unitLabel ? ` · ${assignment.unitLabel}` : ""}
        </span>
        {chip ? <span className="mt-1 flex flex-wrap gap-1.5">{chip}</span> : null}
      </div>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-5 shrink-0 text-slate-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </li>
  );
}
