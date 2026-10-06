import type { Route } from "next";
import Link from "next/link";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { InitialsAvatar, RefChip } from "@/components/reference/locked-reference";
import { KeyValueList } from "@/components/ui/key-value-list";
import type { AssignmentIssueRow } from "@/features/shifts";
import {
  ASSIGNMENT_ISSUE_SEVERITY_LABELS,
  ASSIGNMENT_ISSUE_TYPE_LABELS,
  ASSIGNMENT_STATUS_LABELS,
  formatShiftDate,
  formatShiftTimeRange,
} from "@/lib/domain/shifts";
import { cn } from "@/lib/utils/cn";

import { AttentionIcon, relativeTime } from "./attention-row";

/*
 * Attention Details — the canonical Chelth drawer (CHELTH-LOCKED-VISUAL-
 * SYSTEM.md, C) for one assignment issue, in the locked Notifications
 * reference's "Activity Details" hierarchy. It summarises the issue and links
 * to the shift; the shift record stays the source of truth.
 */

const INK = "text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]";
const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

function Section({
  id,
  title,
  children,
  divided = true,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
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

export function AttentionDetailsPanel({
  issue,
  reasons,
  shiftHref,
}: {
  issue: AssignmentIssueRow;
  /** Plain-language reasons from the existing explainer (not_eligible issues). */
  reasons: string[];
  shiftHref: Route;
}) {
  const id = `attention-${issue.id}`;
  const urgent = issue.severity === "urgent";
  const worker = issue.workerName ?? "Worker";
  return (
    <div className="flex min-h-full flex-col text-[13.5px] leading-5">
      <div className="flex items-start gap-3 pt-1">
        <AttentionIcon tone={urgent ? "danger" : "warning"} icon="operations" />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-2">
            <p className={cn("text-[16px] leading-[22px] font-semibold", INK)}>
              {ASSIGNMENT_ISSUE_TYPE_LABELS[issue.issueType]}
            </p>
            <RefChip tone={urgent ? "danger" : "warning"} className="shrink-0 font-semibold">
              {ASSIGNMENT_ISSUE_SEVERITY_LABELS[issue.severity]}
            </RefChip>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Opened <time dateTime={issue.openedAt}>{relativeTime(issue.openedAt)}</time>
          </p>
        </div>
      </div>

      <p className="mt-3 text-[14px] leading-5 text-slate-600">
        {worker}&apos;s assignment at {issue.facilityName} on {formatShiftDate(issue)} needs a
        decision. Chelth re-checks upcoming assignments every hour.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <InitialsAvatar name={issue.workerName} size={52} />
        <span className="flex min-w-0 flex-col">
          <span className={cn("truncate text-[16px] leading-[22px] font-semibold", INK)}>
            {worker}
          </span>
          <span className="truncate text-[13px] text-slate-600">
            {ASSIGNMENT_STATUS_LABELS[issue.assignmentStatus]}
          </span>
        </span>
      </div>

      <Section id={`${id}-assignment`} title="Assignment Information">
        <KeyValueList
          className="sm:grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] sm:gap-x-5"
          items={[
            { label: "Facility", value: issue.facilityName },
            { label: "Shift", value: `${formatShiftDate(issue)} · ${formatShiftTimeRange(issue)}` },
            { label: "Assignment", value: ASSIGNMENT_STATUS_LABELS[issue.assignmentStatus] },
            { label: "Opened", value: dateTime.format(new Date(issue.openedAt)) },
            { label: "Last checked", value: dateTime.format(new Date(issue.lastEvaluatedAt)) },
          ]}
        />
      </Section>

      {reasons.length > 0 ? (
        <Section id={`${id}-reasons`} title="Why It Needs Attention">
          <ul className="flex flex-col divide-y divide-[rgba(18,107,103,0.10)]">
            {reasons.map((line) => (
              <li key={line} className="py-2 text-[13.5px] leading-5 font-medium text-chelth-navy">
                {line}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="mt-auto flex flex-col gap-2.5 pt-4">
        <Link
          href={shiftHref}
          className="inline-flex h-12 items-center justify-center gap-2.5 rounded-[8px] bg-[linear-gradient(180deg,#00666c,#004f55)] text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_14px_-4px_rgba(0,58,64,0.45)] transition-[filter] hover:brightness-110"
        >
          <WorkspaceNavIcon name="shifts" strokeWidth={2.1} className="size-5" />
          View Shift
        </Link>
      </div>
    </div>
  );
}
