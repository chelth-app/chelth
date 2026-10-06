import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { DetailsTabs } from "@/components/reference/details-tabs";
import { InitialsAvatar, RefChip } from "@/components/reference/locked-reference";
import { ActivityTimeline } from "@/components/ui/activity-timeline";
import { KeyValueList } from "@/components/ui/key-value-list";
import { LocationPin } from "@/components/ui/location-pin";
import type { StatusTone } from "@/components/ui/status-chip";
import {
  type AgencyShiftSummary,
  type AssignmentReadiness,
  FILL_TONE,
  SHIFT_TONE,
  type ShiftAssignment,
  type ShiftNote,
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

/** A row of the shift list (summary plus open issue count). */
export type ShiftListItem = AgencyShiftSummary & { openIssueCount: number };

const INK = "text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]";

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

/** 36 px icon tile (locked drawer tile). */
function IconTile({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[linear-gradient(145deg,#e6f9f3,#ccefe3)] text-chelth-teal-dark [&>svg]:size-[18px]"
    >
      {children}
    </span>
  );
}

/** One row of the reference summary card. */
function SummaryRow({
  icon,
  children,
  aside,
}: {
  icon: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex min-h-[60px] items-center gap-3 px-3.5 py-2.5">
      <IconTile>{icon}</IconTile>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      {aside}
    </div>
  );
}

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
 * Shift Details — the canonical Chelth drawer (CHELTH-LOCKED-VISUAL-SYSTEM.md,
 * C) in the locked Shifts reference hierarchy: summary card, assigned worker,
 * status and credential readiness, then Details / Notes / Activity and the
 * real actions. Data: the list row plus the shift record's own assignment,
 * readiness and note loaders (same capability gates). Nothing invented: no
 * photos, phone numbers, pay rates, reminders or replacement actions.
 */
export function ShiftDetailsPanel({
  shift,
  href,
  assignments,
  readiness,
  notes,
  canSeeAssignments,
  canStaff,
  canOffer,
}: {
  shift: ShiftListItem;
  href: Route;
  /** Active (assigned or accepted) assignments, when the viewer may see them. */
  assignments: ShiftAssignment[];
  readiness: AssignmentReadiness[];
  /** Internal notes (agency only); null when not loaded. */
  notes: ShiftNote[] | null;
  canSeeAssignments: boolean;
  canStaff: boolean;
  canOffer: boolean;
}) {
  const id = `shift-${shift.id}`;
  const role = disciplineNameParts(shift.disciplineName);
  const status = statusLine(shift);
  const lead = assignments[0];
  const relevant = readiness.filter((entry) =>
    assignments.some((assignment) => assignment.id === entry.assignmentId),
  );
  const order: ReadinessStatus[] = ["not_eligible", "action_required", "ready"];
  const worst = order.find((value) => relevant.some((entry) => entry.readiness === value));
  const filled = shift.status === "open" && shift.fillState === "filled";
  const primaryAssign = canStaff && !filled;

  const activity = assignments
    .flatMap((assignment) => [
      {
        id: `${assignment.id}-assigned`,
        at: assignment.assignedAt,
        title: `${assignment.workerName} assigned`,
        tone: "info" as const,
      },
      ...(assignment.acceptedAt
        ? [
            {
              id: `${assignment.id}-accepted`,
              at: assignment.acceptedAt,
              title: `${assignment.workerName} accepted`,
              tone: "success" as const,
            },
          ]
        : []),
    ])
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const tabs = [
    {
      id: "details",
      label: "Details",
      content: (
        <Section id={`${id}-details`} title="Shift Information" divided={false}>
          <KeyValueList
            className="sm:grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] sm:gap-x-5"
            items={[
              { label: "Facility", value: shift.facilityName },
              { label: "Unit", value: shift.locationName },
              { label: "Role", value: shift.disciplineName },
              {
                label: "Workers needed",
                value: `${shift.activeCount} of ${shift.requestedHeadcount} assigned · ${shift.acceptedCount} accepted`,
              },
              { label: "Timezone", value: shift.timezone },
              { label: "Source", value: SHIFT_SOURCE_LABELS[shift.source] },
              {
                label: "Relationship",
                value: RELATIONSHIP_STATUS_LABELS[shift.relationshipStatus],
              },
              ...(shift.externalReference
                ? [{ label: "Reference", value: shift.externalReference }]
                : []),
            ]}
          />
        </Section>
      ),
    },
    ...(notes
      ? [
          {
            id: "notes",
            label: "Notes",
            content: (
              <Section id={`${id}-notes`} title="Internal Notes" divided={false}>
                <p className="text-[12.5px] leading-[18px] text-slate-600">
                  Visible to your agency only — never to the facility or workers.
                </p>
                {notes.length === 0 ? (
                  <p className="text-[13.5px] font-medium text-slate-600">No notes yet.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-[rgba(18,107,103,0.10)]">
                    {notes.slice(0, 4).map((note) => (
                      <li key={note.id} className="flex flex-col gap-1 py-2.5">
                        <p className="line-clamp-3 text-[13.5px] leading-5 whitespace-pre-line text-chelth-navy">
                          {note.body}
                        </p>
                        <time dateTime={note.createdAt} className="text-[12px] text-slate-500">
                          {dateTime.format(new Date(note.createdAt))}
                        </time>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            ),
          },
        ]
      : []),
    {
      id: "activity",
      label: "Activity",
      content: (
        <Section id={`${id}-activity`} title="Recent Activity" divided={false}>
          {activity.length === 0 ? (
            <p className="text-[13.5px] font-medium text-slate-600">
              {canSeeAssignments
                ? "No assignment activity yet."
                : "Assignment activity is on the shift record."}
            </p>
          ) : (
            <ActivityTimeline
              label={`Activity for ${shift.facilityName}`}
              items={activity.slice(0, 5).map((event) => ({
                id: event.id,
                tone: event.tone,
                title: event.title,
                meta: <time dateTime={event.at}>{dateTime.format(new Date(event.at))}</time>,
              }))}
            />
          )}
        </Section>
      ),
    },
  ];

  return (
    <div className="flex min-h-full flex-col text-[13.5px] leading-5">
      {/* Reference summary card: date and time, facility and unit, role. */}
      <div className="flex flex-col divide-y divide-[rgba(18,107,103,0.12)] rounded-[12px] border border-[rgba(18,107,103,0.14)] bg-white/80">
        <SummaryRow
          icon={<WorkspaceNavIcon name="shifts" strokeWidth={2.1} />}
          aside={
            <span className="shrink-0 rounded-full bg-surface-muted px-2.5 py-0.5 text-[12px] leading-[18px] font-medium text-slate-600">
              {durationLabel(shift)}
            </span>
          }
        >
          <span className="text-[13px] leading-[18px] font-medium text-slate-600">
            {formatShiftDate(shift)}
          </span>
          <span className={cn("font-display text-[17px] leading-[23px] font-bold", INK)}>
            {formatShiftTimeRange(shift)}
          </span>
        </SummaryRow>
        <SummaryRow icon={<LocationPin className="size-[18px]" />}>
          <span className={cn("text-[14px] leading-5 font-semibold", INK)}>
            {shift.facilityName}
          </span>
          <span className="text-[12.5px] leading-[18px] text-slate-600">{shift.locationName}</span>
        </SummaryRow>
        <SummaryRow icon={<WorkspaceNavIcon name="workforce" strokeWidth={2.1} />}>
          <span className={cn("text-[14px] leading-5 font-semibold", INK)}>{role.name}</span>
          {role.code ? (
            <span className="text-[12.5px] leading-[18px] text-slate-600">{role.code}</span>
          ) : null}
        </SummaryRow>
      </div>

      <Section
        id={`${id}-assigned`}
        title={assignments.length > 1 ? "Assigned Workers" : "Assigned Worker"}
      >
        {lead ? (
          <div className="flex items-center gap-3.5">
            <span className="rounded-full shadow-[0_6px_16px_rgba(0,90,96,0.16)] ring-4 ring-white">
              <InitialsAvatar name={lead.workerName} size={52} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className={cn("truncate text-[15px] leading-5 font-semibold", INK)}>
                {lead.workerName}
                {assignments.length > 1 ? ` +${assignments.length - 1}` : ""}
              </span>
              <span className="text-[12.5px] leading-[18px] text-slate-600">
                {role.code ?? role.name} · {ASSIGNMENT_STATUS_LABELS[lead.status]}
              </span>
              <span className="text-[12.5px] leading-[18px] text-slate-600">
                {shift.activeCount} of {shift.requestedHeadcount} assigned · {shift.acceptedCount}{" "}
                accepted
              </span>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3.5">
            <InitialsAvatar name={null} size={52} muted />
            <span className="flex min-w-0 flex-col">
              <span className={cn("text-[15px] leading-5 font-semibold", INK)}>
                {shift.activeCount > 0 && !canSeeAssignments
                  ? `${shift.activeCount} assigned`
                  : "No worker assigned"}
              </span>
              <span className="text-[12.5px] leading-[18px] text-slate-600">
                {shift.activeCount} of {shift.requestedHeadcount} assigned · {shift.acceptedCount}{" "}
                accepted
              </span>
            </span>
          </div>
        )}
      </Section>

      {/* Status and credential readiness (reference rows). */}
      <div className="flex flex-col gap-3 border-t border-[rgba(18,107,103,0.12)] py-3.5">
        <div className="flex items-start gap-3">
          <span className="w-[136px] shrink-0 text-[13.5px] font-medium text-slate-600">
            Status
          </span>
          <span className="flex min-w-0 flex-col items-start gap-1">
            <RefChip tone={status.tone} className="font-semibold">
              {status.label}
            </RefChip>
            {status.note ? (
              <span className="text-[12.5px] leading-[18px] text-slate-600">{status.note}</span>
            ) : null}
          </span>
        </div>
        <div className="flex items-start gap-3">
          <span className="w-[136px] shrink-0 text-[13.5px] font-medium text-slate-600">
            Credential readiness
          </span>
          <span className="flex min-w-0 flex-col items-start gap-1">
            {worst ? (
              <RefChip tone={READINESS_TONE[worst]} className="font-semibold">
                {READINESS_LABELS[worst]}
              </RefChip>
            ) : (
              <RefChip tone="neutral" className="font-semibold">
                Not started
              </RefChip>
            )}
            <span className="text-[12.5px] leading-[18px] text-slate-600">
              {worst === "ready"
                ? "All required credentials are active."
                : worst
                  ? "Review the assignee's credentials on the shift record."
                  : shift.openIssueCount > 0
                    ? `${shift.openIssueCount} open ${shift.openIssueCount === 1 ? "issue" : "issues"} on this shift.`
                    : "No worker assigned yet."}
            </span>
          </span>
        </div>
      </div>

      <div className="mt-1">
        <DetailsTabs label={`${shift.facilityName} shift`} tabs={tabs} />
      </div>

      {/* Locked action region: real, permitted actions only. */}
      <div className="mt-auto flex flex-col gap-2.5 pt-4">
        <Link
          href={(primaryAssign ? `${href}#assign-heading` : href) as Route}
          className="inline-flex h-12 items-center justify-center gap-2.5 rounded-[8px] bg-[linear-gradient(180deg,#00666c,#004f55)] text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_14px_-4px_rgba(0,58,64,0.45)] transition-[filter] hover:brightness-110"
        >
          <WorkspaceNavIcon
            name={primaryAssign ? "workforce" : "shifts"}
            strokeWidth={2.1}
            className="size-5"
          />
          {primaryAssign ? "Assign Worker" : "Open shift"}
        </Link>
        {primaryAssign || (canOffer && !filled) ? (
          <div
            className={cn("grid gap-2.5", canOffer && !filled && primaryAssign && "grid-cols-2")}
          >
            {canOffer && !filled ? (
              <Link
                href={`${href}#offer-heading` as Route}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-[rgba(0,90,96,0.35)] bg-white text-[14px] font-semibold text-chelth-navy shadow-[0_1px_2px_rgba(13,47,66,0.05)] hover:border-chelth-teal-dark hover:bg-[#f4fbf9]"
              >
                <WorkspaceNavIcon
                  name="requests"
                  strokeWidth={2.1}
                  className="size-[18px] text-chelth-teal-dark"
                />
                Offer shift
              </Link>
            ) : null}
            {primaryAssign ? (
              <Link
                href={href}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-[rgba(0,90,96,0.35)] bg-white text-[14px] font-semibold text-chelth-navy shadow-[0_1px_2px_rgba(13,47,66,0.05)] hover:border-chelth-teal-dark hover:bg-[#f4fbf9]"
              >
                <WorkspaceNavIcon
                  name="shifts"
                  strokeWidth={2.1}
                  className="size-[18px] text-chelth-teal-dark"
                />
                Open shift
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
