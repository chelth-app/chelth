import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { InitialsAvatar, RefChip } from "@/components/reference/locked-reference";
import { LocationPin } from "@/components/ui/location-pin";
import type { StatusTone } from "@/components/ui/status-chip";
import {
  type AgencyShiftSummary,
  type AssignmentReadiness,
  FILL_TONE,
  SHIFT_TONE,
  type ShiftAssignment,
} from "@/features/shifts";
import { READINESS_LABELS, type ReadinessStatus } from "@/lib/domain/credentials";
import {
  ASSIGNMENT_STATUS_LABELS,
  disciplineNameParts,
  FILL_STATE_LABELS,
  formatShiftDate,
  formatShiftTimeRange,
  SHIFT_SOURCE_LABELS,
  SHIFT_STATUS_LABELS,
  shiftDurationHours,
} from "@/lib/domain/shifts";
import { RELATIONSHIP_STATUS_LABELS } from "@/lib/domain/vocabulary";
import { cn } from "@/lib/utils/cn";

/** A row of the paginated shift list (summary plus open issue count). */
type ShiftListItem = AgencyShiftSummary & { openIssueCount: number };

const READINESS_TONE: Record<ReadinessStatus, StatusTone> = {
  ready: "success",
  action_required: "warning",
  not_eligible: "danger",
};

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

function durationLabel(shift: ShiftListItem): string {
  const hours = Math.round(shiftDurationHours(shift) * 10) / 10;
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

function statusLine(shift: ShiftListItem): {
  tone: StatusTone;
  label: string;
  note: string | null;
} {
  if (shift.status !== "open") {
    return { tone: SHIFT_TONE[shift.status], label: SHIFT_STATUS_LABELS[shift.status], note: null };
  }
  const toFill = Math.max(shift.requestedHeadcount - shift.activeCount, 0);
  const note = toFill === 0 ? "Every place is filled." : "This shift needs coverage.";
  return shift.fillState === "unfilled"
    ? { tone: "danger", label: "Open", note }
    : { tone: FILL_TONE[shift.fillState], label: FILL_STATE_LABELS[shift.fillState], note };
}

/** One summary-card row (locked P3, CSS px): 37 px icon column, text at 59 px. */
function SummaryRow({
  icon,
  children,
  aside,
  tall = false,
}: {
  icon: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
  tall?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-[13px] px-[9px]",
        tall ? "min-h-[71px]" : "min-h-[60px]",
      )}
    >
      {icon}
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      {aside}
    </div>
  );
}

function IconCell({ circle = false, children }: { circle?: boolean; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-[37px] shrink-0 items-center justify-center text-chelth-navy [&>svg]:size-5",
        circle && "rounded-full bg-surface-muted",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Shift Details drawer body — the locked P3 panel reproduced at CSS scale
 * (reference px / 0.87). Data: the list row plus the shift record's own
 * assignment and readiness loaders (same capability gates). Not fabricated:
 * no photos, phone numbers, notes or secondary actions that do not exist —
 * the slots keep their geometry with the truthful equivalent.
 */
export function ShiftDetailsPanel({
  shift,
  href,
  assignments,
  readiness,
  canSeeAssignments,
  canStaff,
  canOffer,
}: {
  shift: ShiftListItem;
  href: Route;
  /** Active (assigned or accepted) assignments, when the viewer may see them. */
  assignments: ShiftAssignment[];
  readiness: AssignmentReadiness[];
  canSeeAssignments: boolean;
  canStaff: boolean;
  canOffer: boolean;
}) {
  const role = disciplineNameParts(shift.disciplineName);
  const status = statusLine(shift);
  const lead = assignments[0];
  const relevant = readiness.filter((entry) =>
    assignments.some((assignment) => assignment.id === entry.assignmentId),
  );
  const order: ReadinessStatus[] = ["not_eligible", "action_required", "ready"];
  const worst = order.find((value) => relevant.some((entry) => entry.readiness === value));
  const filled = shift.status === "open" && shift.fillState === "filled";
  const details: { label: string; value: ReactNode }[] = [
    { label: "Facility", value: shift.facilityName },
    { label: "Unit", value: shift.locationName },
    { label: "Role", value: shift.disciplineName },
    { label: "Timezone", value: shift.timezone },
    { label: "Source", value: SHIFT_SOURCE_LABELS[shift.source] },
    { label: "Relationship", value: RELATIONSHIP_STATUS_LABELS[shift.relationshipStatus] },
    ...(shift.externalReference ? [{ label: "Reference", value: shift.externalReference }] : []),
  ];
  const activity = assignments
    .flatMap((assignment) => [
      {
        at: assignment.assignedAt,
        title: `${assignment.workerName} assigned`,
        tone: "info" as const,
      },
      ...(assignment.acceptedAt
        ? [
            {
              at: assignment.acceptedAt,
              title: `${assignment.workerName} accepted`,
              tone: "success" as const,
            },
          ]
        : []),
    ])
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 3);
  const primaryAction = canStaff && !filled;

  return (
    <div className="flex flex-col text-[12px] leading-[17px]">
      <div className="flex flex-col divide-y divide-chelth-border/70 rounded-xl border border-chelth-border/70">
        <SummaryRow
          tall
          icon={
            <IconCell circle>
              <WorkspaceNavIcon name="shifts" />
            </IconCell>
          }
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-[14.25px] leading-5 tracking-[-0.01em] text-muted-foreground">
              {formatShiftDate(shift)}
            </span>
            <span className="shrink-0 rounded-full bg-surface-muted px-2.5 py-0.5 text-[12px] leading-[18px] text-muted-foreground">
              {durationLabel(shift)}
            </span>
          </span>
          <span className="text-[16.5px] leading-[22px] font-bold text-chelth-navy">
            {formatShiftTimeRange(shift)}
          </span>
        </SummaryRow>
        <SummaryRow
          icon={
            <IconCell>
              <LocationPin className="size-5 text-chelth-navy" />
            </IconCell>
          }
        >
          <span className="text-[13px] leading-[18px] font-semibold tracking-[-0.01em] text-chelth-navy">
            {shift.facilityName}
          </span>
          <span className="text-muted-foreground">{shift.locationName}</span>
        </SummaryRow>
        <SummaryRow
          icon={
            <IconCell>
              <WorkspaceNavIcon name="workforce" />
            </IconCell>
          }
        >
          <span className="text-[13px] leading-[18px] font-semibold tracking-[-0.01em] text-chelth-navy">
            {role.name}
          </span>
          {role.code ? <span className="text-muted-foreground">{role.code}</span> : null}
        </SummaryRow>

        {/* Assigned worker (P3 block, 123 px). */}
        <div className="flex min-h-[123px] flex-col gap-2.5 px-[15px] py-3.5">
          <span className="text-[13px] leading-[18px] font-bold text-chelth-navy">
            Assigned Worker{assignments.length > 1 ? "s" : ""}
          </span>
          {lead ? (
            <span className="flex items-center gap-[17px]">
              <span className="relative">
                <InitialsAvatar name={lead.workerName} size={52} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] leading-[18px] font-semibold text-chelth-navy">
                  {lead.workerName}
                  {assignments.length > 1 ? ` +${assignments.length - 1}` : ""}
                </span>
                <span className="text-muted-foreground">{role.code ?? role.name}</span>
                <span className="text-muted-foreground">
                  {ASSIGNMENT_STATUS_LABELS[lead.status]}
                </span>
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-[17px]">
              <InitialsAvatar name={null} size={52} muted />
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] leading-[18px] font-semibold text-chelth-navy">
                  {shift.activeCount > 0 && !canSeeAssignments
                    ? `${shift.activeCount} assigned`
                    : "No worker assigned"}
                </span>
                <span className="text-muted-foreground">
                  {shift.activeCount} of {shift.requestedHeadcount} assigned · {shift.acceptedCount}{" "}
                  accepted
                </span>
              </span>
            </span>
          )}
        </div>

        {/* Status (P3 row, 55 px): label at 37 px, chip at 113 px, note under the chip. */}
        <div className="grid min-h-[55px] grid-cols-[22px_76px_minmax(0,1fr)] items-center gap-y-1 py-2.5 pr-3 pl-[15px]">
          <span aria-hidden="true" className="text-chelth-navy [&>svg]:size-4">
            <WorkspaceNavIcon name="shifts" />
          </span>
          <span className="text-[12px] font-semibold text-chelth-navy">Status</span>
          <span>
            <RefChip tone={status.tone}>{status.label}</RefChip>
          </span>
          {status.note ? (
            <span className="col-start-3 text-muted-foreground">{status.note}</span>
          ) : null}
        </div>

        {/* Credential readiness (P3 row, 57 px): the assignees' live readiness. */}
        <div className="grid min-h-[57px] grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-1.5 py-2.5 pr-3 pl-[15px]">
          <span aria-hidden="true" className="text-primary [&>svg]:size-[18px]">
            <WorkspaceNavIcon name="compliance" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[12px] font-semibold text-chelth-navy">Credential Readiness</span>
            <span className="text-[11.5px] leading-4 text-muted-foreground">
              {worst === "ready"
                ? "All required credentials are active."
                : worst
                  ? "Review the assignee's credentials on the shift record."
                  : shift.openIssueCount > 0
                    ? `${shift.openIssueCount} open ${shift.openIssueCount === 1 ? "issue" : "issues"} on this shift.`
                    : "No worker assigned yet."}
            </span>
          </span>
          {worst ? (
            <RefChip tone={READINESS_TONE[worst]}>{READINESS_LABELS[worst]}</RefChip>
          ) : (
            <RefChip tone="neutral">Not started</RefChip>
          )}
        </div>
      </div>

      <section aria-labelledby={`shift-details-${shift.id}`} className="mt-3 flex flex-col">
        {/* Locked P3 tab bar: three equal columns; only Details exists in Chelth. */}
        <div className="grid h-[38px] grid-cols-3 border-b border-chelth-border">
          <h3
            id={`shift-details-${shift.id}`}
            className="-mb-px flex items-center justify-center border-b-2 border-primary text-[12.5px] font-semibold text-chelth-navy"
          >
            Details
          </h3>
        </div>
        <dl className="mt-3 grid grid-cols-[103px_minmax(0,1fr)] px-[6px] text-[11.75px] leading-[23px] font-medium">
          {details.map((item) => (
            <div key={item.label} className="contents">
              <dt className="text-muted-foreground">{item.label}</dt>
              <dd className="min-w-0 break-words text-slate-600">{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Locked P3 action region: one primary (334 × 44), two secondaries (163 × 44). */}
      <div className="mt-[18px] flex flex-col gap-2 px-[6px]">
        <Link
          href={(primaryAction ? `${href}#assign-heading` : href) as Route}
          className="inline-flex h-11 items-center justify-center gap-2.5 rounded-[7px] bg-chelth-teal-dark text-[13px] font-semibold text-white hover:bg-chelth-teal"
        >
          {primaryAction ? (
            <>
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
                className="size-[18px]"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
              >
                <circle cx="9" cy="8" r="3.5" />
                <path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" />
              </svg>
              Assign worker
            </>
          ) : (
            "Open shift"
          )}
        </Link>
        <div className="grid grid-cols-2 gap-2">
          {canOffer && !filled ? (
            <Link
              href={`${href}#offer-heading` as Route}
              className="inline-flex h-11 items-center justify-center rounded-[7px] border border-chelth-teal-dark/45 text-[12.5px] font-medium text-chelth-navy hover:bg-surface-muted"
            >
              Offer shift
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
          {primaryAction ? (
            <Link
              href={href}
              className="inline-flex h-11 items-center justify-center rounded-[7px] border border-chelth-teal-dark/45 text-[12.5px] font-medium text-chelth-navy hover:bg-surface-muted"
            >
              Open shift
            </Link>
          ) : null}
        </div>
      </div>

      {/* Locked P3 timeline region: real assignment events only. */}
      <section
        aria-labelledby={`shift-activity-${shift.id}`}
        className="mt-[42px] flex flex-col gap-3 px-[6px]"
      >
        <div className="flex items-center justify-between">
          <h3
            id={`shift-activity-${shift.id}`}
            className="text-[14.75px] leading-5 font-extrabold tracking-[-0.01em] text-chelth-navy"
          >
            Recent Activity
          </h3>
          <Link
            href={`${href}#assignments-heading` as Route}
            className="text-[12.5px] font-medium text-primary hover:underline"
          >
            View All
          </Link>
        </div>
        {activity.length === 0 ? (
          <p className="text-muted-foreground">
            {canSeeAssignments ? "No assignment activity yet." : "Activity is on the shift record."}
          </p>
        ) : (
          <ol className="flex flex-col">
            {activity.map((event, index) => (
              <li
                key={`${event.at}-${index}`}
                className="grid min-h-[52px] grid-cols-[30px_minmax(0,1fr)]"
              >
                <span aria-hidden="true" className="relative flex justify-center">
                  <span
                    className={cn(
                      "mt-0.5 size-3.5 rounded-full",
                      event.tone === "success" ? "bg-success-indicator" : "bg-info-indicator",
                    )}
                  />
                  {index < activity.length - 1 ? (
                    <span className="absolute top-5 bottom-0 w-px bg-chelth-border" />
                  ) : null}
                </span>
                <span className="flex flex-col">
                  <span className="text-[12.5px] font-semibold text-chelth-navy">
                    {event.title}
                  </span>
                  <time dateTime={event.at} className="text-[11.5px] text-muted-foreground">
                    {dateTime.format(new Date(event.at))}
                  </time>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
