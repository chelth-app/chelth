import type { Metadata } from "next";
import Link from "next/link";

import { Panel } from "@/components/ui/panel";
import { notFound } from "next/navigation";
import { z } from "zod";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { ActivityTimeline } from "@/components/ui/activity-timeline";
import { EmptyState } from "@/components/ui/empty-state";
import { KeyValueList } from "@/components/ui/key-value-list";
import { PageHeader } from "@/components/ui/page-header";
import { loadOrganisationPage } from "@/features/organisations";
import {
  ApproveTimesheetForms,
  getTimesheet,
  listTimesheetEntries,
  listTimesheetHistory,
  rebuildTimesheetAction,
  ReopenTimesheetForm,
  ResolveDisputeForm,
  SubmitTimesheetForm,
  TimesheetEntriesTable,
  TimesheetStatusBadge,
} from "@/features/timesheets";
import { CAPABILITIES } from "@/lib/authz";
import { formatShiftDate } from "@/lib/domain/shifts";
import {
  BLOCKING_REASON_HELP,
  blockingReasonLabel,
  DISPUTE_REASON_LABELS,
  formatPeriod,
  formatWorkedMinutes,
  HISTORY_ACTION_LABELS,
  REJECTION_REASON_LABELS,
  REOPEN_REASON_LABELS,
} from "@/lib/domain/timesheets";

export const metadata: Metadata = { title: "Timesheet" };

const idSchema = z.uuid();
const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function reasonLabel(code: string | null): string | null {
  if (!code) return null;
  return (
    (REJECTION_REASON_LABELS as Record<string, string>)[code] ??
    (REOPEN_REASON_LABELS as Record<string, string>)[code] ??
    (DISPUTE_REASON_LABELS as Record<string, string>)[code] ??
    (code === "times_confirmed" ? "Times confirmed" : code)
  );
}

/** One timesheet: the worker's own, or any in the agency for timesheet.view holders. */
export default async function TimesheetPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/timesheets/[timesheetId]">) {
  const { organisationId: rawOrganisationId, timesheetId: rawTimesheetId } = await params;
  const context = await loadOrganisationPage(rawOrganisationId);
  const { organisationId, can } = context;
  const parsed = idSchema.safeParse(rawTimesheetId);
  if (!parsed.success) notFound();
  const sheet = await getTimesheet(parsed.data);
  if (!sheet || sheet.organisationId !== organisationId) notFound();
  const [entries, history] = await Promise.all([
    listTimesheetEntries(sheet.id),
    listTimesheetHistory(sheet.id),
  ]);

  const isWorker = sheet.viewerIsWorker;
  const canApprove = !isWorker && can(CAPABILITIES.TIMESHEET_APPROVE) === "granted";
  const canSeeAttendance = !isWorker && can(CAPABILITIES.ATTENDANCE_VIEW) === "granted";
  const canSubmit =
    isWorker &&
    (sheet.status === "open" || sheet.status === "rejected") &&
    sheet.submitBlockingReasons.length === 0;
  const disputes = new Map(
    history
      .filter(
        (item) =>
          item.action === "facility_disputed" && item.entryId && item.revision === sheet.revision,
      )
      .map((item) => [item.entryId ?? "", item]),
  );
  const disputedEntries = entries.filter((entry) => entry.facilityState === "disputed");
  const blocking = isWorker ? sheet.submitBlockingReasons : sheet.approvalBlockingReasons;
  const showBlocking =
    (isWorker && (sheet.status === "open" || sheet.status === "rejected")) ||
    (!isWorker && sheet.status === "submitted");

  return (
    <>
      <PageHeader
        title={isWorker ? "My timesheet" : (sheet.workerName ?? "Worker")}
        back={
          <Link
            href={`/app/organisations/${organisationId}/timesheets`}
            className="text-primary underline underline-offset-4"
          >
            Timesheets
          </Link>
        }
        description={
          <p className="text-sm">
            Week {formatPeriod(sheet.periodStart, sheet.periodEnd)}
            {sheet.revision > 1 ? ` · Revision ${sheet.revision}` : ""}
          </p>
        }
        meta={
          <>
            <TimesheetStatusBadge status={sheet.status} />
            {sheet.approvedByName && sheet.agencyApprovedAt ? (
              <span className="text-sm text-muted-foreground">
                Approved by {sheet.approvedByName}, {when.format(new Date(sheet.agencyApprovedAt))}
              </span>
            ) : null}
          </>
        }
      />

      <div className="max-w-xl rounded-lg border border-border bg-surface p-4 shadow-card">
        <KeyValueList
          aria-label="Timesheet totals"
          items={[
            {
              label: "Worked",
              value: (
                <span className="font-semibold tabular-nums">
                  {formatWorkedMinutes(sheet.totalWorkedMinutes)}
                </span>
              ),
            },
            {
              label: "Breaks",
              value: (
                <span className="tabular-nums">{formatWorkedMinutes(sheet.totalBreakMinutes)}</span>
              ),
            },
            { label: "Shifts", value: <span className="tabular-nums">{sheet.entryCount}</span> },
          ]}
        />
      </div>

      {sheet.status === "rejected" || (sheet.returnNote && sheet.status === "open") ? (
        <p
          role="note"
          className="max-w-2xl rounded-md bg-warning-soft p-3 text-sm text-warning-soft-foreground"
        >
          {sheet.status === "rejected" && sheet.rejectionReason
            ? `Returned: ${REJECTION_REASON_LABELS[sheet.rejectionReason]}.`
            : "Reopened by your agency."}
          {sheet.returnNote ? ` “${sheet.returnNote}”` : ""}
        </p>
      ) : null}

      {showBlocking && blocking.length > 0 ? (
        <Panel
          titleId="blocking-heading"
          title={<>{isWorker ? "Before you can submit" : "Before this can be approved"}</>}
        >
          <ul aria-label="Blocking reasons" className="flex flex-col gap-1 text-sm">
            {blocking.map((reason) => (
              <li key={reason} className="flex flex-col">
                <span className="font-medium">{blockingReasonLabel(reason)}</span>
                {isWorker && BLOCKING_REASON_HELP[reason] ? (
                  <span className="text-muted-foreground">{BLOCKING_REASON_HELP[reason]}</span>
                ) : null}
              </li>
            ))}
          </ul>
          {isWorker ? (
            <Link
              href={`/app/organisations/${organisationId}/my-shifts`}
              className="w-fit text-sm text-primary underline underline-offset-4"
            >
              Request a correction on My shifts
            </Link>
          ) : null}
        </Panel>
      ) : null}

      {canSubmit ? (
        <SubmitTimesheetForm organisationId={organisationId} timesheetId={sheet.id} />
      ) : null}

      {canApprove && sheet.status === "submitted" ? (
        <ApproveTimesheetForms
          organisationId={organisationId}
          timesheetId={sheet.id}
          revision={sheet.revision}
          canApprove={sheet.approvalBlockingReasons.length === 0}
        />
      ) : null}

      <Panel titleId="entries-heading" title={<>Shifts</>}>
        <TimesheetEntriesTable
          entries={entries}
          showFacilityState={sheet.status === "agency_approved" || sheet.status === "locked"}
          {...(canSeeAttendance
            ? {
                attendanceHref: (attendanceId: string) =>
                  `/app/organisations/${organisationId}/attendance/${attendanceId}` as const,
              }
            : {})}
        />
      </Panel>

      {canApprove && disputedEntries.length > 0 ? (
        <Panel titleId="disputes-heading" title={<>Facility discrepancies</>}>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Confirm the times stand, or correct the attendance from the entry&apos;s attendance
            history (that creates a new revision for re-approval).
          </p>
          <ul aria-label="Facility discrepancies" className="flex flex-col gap-3">
            {disputedEntries.map((entry) => {
              const dispute = disputes.get(entry.id);
              return (
                <li
                  key={entry.id}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm"
                >
                  <p>
                    <span className="font-medium">
                      {entry.facilityName},{" "}
                      {formatShiftDate({
                        startAt: entry.scheduledStartAt,
                        timezone: entry.timezone,
                      })}
                    </span>
                    {dispute ? ` · ${reasonLabel(dispute.reasonCode) ?? ""}` : ""}
                  </p>
                  {dispute?.note ? <p className="text-muted-foreground">“{dispute.note}”</p> : null}
                  <ResolveDisputeForm
                    organisationId={organisationId}
                    timesheetId={sheet.id}
                    entryId={entry.id}
                  />
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}

      {canApprove && (sheet.status === "agency_approved" || sheet.status === "locked") ? (
        <ReopenTimesheetForm organisationId={organisationId} timesheetId={sheet.id} />
      ) : null}
      {canApprove && sheet.status !== "agency_approved" && sheet.status !== "locked" ? (
        <div className="w-fit">
          <InlineActionForm
            action={rebuildTimesheetAction}
            fields={{ organisationId, timesheetId: sheet.id }}
            label="Recalculate from attendance"
            variant="ghost"
          />
        </div>
      ) : null}

      <Panel titleId="timesheet-history-heading" title={<>Timesheet history</>}>
        {history.length === 0 ? (
          <EmptyState headingLevel={3} title="Nothing has happened yet." />
        ) : (
          <ActivityTimeline
            label="Timesheet history"
            items={history.map((item, index) => ({
              id: `${item.action}-${item.occurredAt}-${index}`,
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
                    {when.format(new Date(item.occurredAt))}
                  </time>
                  {reasonLabel(item.reasonCode) ? ` · ${reasonLabel(item.reasonCode)}` : ""}
                  {item.actorName ? ` · ${item.actorName}` : ""}
                  {item.note ? <span className="block">“{item.note}”</span> : null}
                </>
              ),
            }))}
          />
        )}
      </Panel>
    </>
  );
}
