import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { RefChip } from "@/components/reference/locked-reference";
import {
  RECORD_ROW,
  RECORD_ROW_META,
  RECORD_ROW_TITLE,
  RecordList,
  RecordMeta,
  RecordNote,
  RecordPage,
} from "@/components/reference/record-page";
import { ActivityTimeline } from "@/components/ui/activity-timeline";
import { EmptyState } from "@/components/ui/empty-state";
import { KeyValueList } from "@/components/ui/key-value-list";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SectionTabs } from "@/components/ui/section-tabs";
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
  FACILITY_STATE_LABELS,
  formatPeriod,
  formatWorkedMinutes,
  HISTORY_ACTION_LABELS,
  REJECTION_REASON_LABELS,
  type TimesheetFacilityState,
} from "@/lib/domain/timesheets";

import { historyWhen as when, reasonLabel } from "../_components/history-format";
import { FACILITY_STATE_TONE } from "../_components/timesheet-tones";

export const metadata: Metadata = { title: "Timesheet" };

const idSchema = z.uuid();

/**
 * One timesheet: the worker's own, or any in the agency for timesheet.view
 * holders. Canonical record arrangement (CHELTH-LOCKED-VISUAL-SYSTEM.md):
 * header, status, section tabs, summary, shifts, sign-off, review, history.
 */
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
  const approved = sheet.status === "agency_approved" || sheet.status === "locked";
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
  const included = entries.filter((entry) => entry.included);
  const signoffStates = (Object.keys(FACILITY_STATE_LABELS) as TimesheetFacilityState[])
    .map((state) => ({
      state,
      count: included.filter((entry) => entry.facilityState === state).length,
    }))
    .filter((item) => item.count > 0);
  const adjustments = included.reduce((sum, entry) => sum + entry.approvedCorrections, 0);

  const returnedNote =
    sheet.status === "rejected" || (sheet.returnNote && sheet.status === "open") ? (
      <p
        role="note"
        className="max-w-2xl rounded-md bg-warning-soft p-3 text-sm text-warning-soft-foreground"
      >
        {sheet.status === "rejected" && sheet.rejectionReason
          ? `Returned: ${REJECTION_REASON_LABELS[sheet.rejectionReason]}.`
          : "Reopened by your agency."}
        {sheet.returnNote ? ` “${sheet.returnNote}”` : ""}
      </p>
    ) : null;

  const blockingList =
    showBlocking && blocking.length > 0 ? (
      <div className="flex flex-col gap-2">
        <h3 className={RECORD_ROW_TITLE}>
          {isWorker ? "Before you can submit" : "Before this can be approved"}
        </h3>
        <RecordList label="Blocking reasons">
          {blocking.map((reason) => (
            <li key={reason} className={RECORD_ROW}>
              <span className="flex min-w-0 flex-col">
                <span className="text-[14px] leading-5 font-medium text-chelth-navy">
                  {blockingReasonLabel(reason)}
                </span>
                {isWorker && BLOCKING_REASON_HELP[reason] ? (
                  <span className={RECORD_ROW_META}>{BLOCKING_REASON_HELP[reason]}</span>
                ) : null}
              </span>
            </li>
          ))}
        </RecordList>
        {isWorker ? (
          <Link
            href={`/app/organisations/${organisationId}/my-shifts`}
            className="w-fit text-sm font-medium text-primary underline underline-offset-4"
          >
            Request a correction on My shifts
          </Link>
        ) : null}
      </div>
    ) : null;

  const sections = [
    { label: "Summary", href: "#summary-heading" as Route, current: false },
    { label: "Shifts", href: "#entries-heading" as Route, current: false },
    ...(!isWorker
      ? [{ label: "Facility sign-off", href: "#signoff-heading" as Route, current: false }]
      : []),
    {
      label: isWorker ? "Submission" : "Approval",
      href: (isWorker ? "#submission-heading" : "#review-heading") as Route,
      current: false,
    },
    { label: "History", href: "#timesheet-history-heading" as Route, current: false },
  ];

  return (
    // Locked inner-page system (docs/ui-reference/CHELTH-LOCKED-VISUAL-SYSTEM.md).
    <RecordPage>
      <PageHeader
        variant="reference"
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
          <p>
            Week {formatPeriod(sheet.periodStart, sheet.periodEnd)}
            {sheet.revision > 1 ? ` · Revision ${sheet.revision}` : ""}
          </p>
        }
        meta={
          <>
            <TimesheetStatusBadge status={sheet.status} />
            {sheet.approvedByName && sheet.agencyApprovedAt ? (
              <RecordMeta>
                Approved by {sheet.approvedByName}, {when.format(new Date(sheet.agencyApprovedAt))}
              </RecordMeta>
            ) : null}
          </>
        }
      />

      <SectionTabs label="Timesheet record sections" tabs={sections} />

      <Panel titleId="summary-heading" title={<>Summary</>}>
        <KeyValueList
          aria-label="Timesheet totals"
          className="max-w-2xl"
          items={[
            { label: "Status", value: <TimesheetStatusBadge status={sheet.status} /> },
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
            {
              label: "Source",
              value: (
                <RefChip tone="info" className="font-semibold">
                  Attendance (derived)
                </RefChip>
              ),
            },
            {
              label: "Adjustments",
              value:
                adjustments === 0
                  ? "None"
                  : adjustments === 1
                    ? "1 approved correction"
                    : `${adjustments} approved corrections`,
            },
            {
              label: "Revision",
              value:
                sheet.revision > 1
                  ? `Revision ${sheet.revision} (current). Earlier revisions are kept in the history.`
                  : "First revision",
            },
            {
              label: "Submitted",
              value: sheet.submittedAt ? when.format(new Date(sheet.submittedAt)) : "Not yet",
            },
          ]}
        />
        <RecordNote>
          Worked time comes only from clock events and approved corrections; it cannot be typed in.
        </RecordNote>
      </Panel>

      <Panel titleId="entries-heading" title={<>Shifts</>}>
        <TimesheetEntriesTable
          entries={entries}
          showFacilityState={approved}
          {...(canSeeAttendance
            ? {
                attendanceHref: (attendanceId: string) =>
                  `/app/organisations/${organisationId}/attendance/${attendanceId}` as const,
              }
            : {})}
        />
      </Panel>

      {!isWorker ? (
        <Panel titleId="signoff-heading" title={<>Facility sign-off</>}>
          {!approved ? (
            <RecordNote>
              Facility sign-off starts after the agency approves this timesheet.
            </RecordNote>
          ) : signoffStates.length === 0 ? (
            <RecordNote>No entries in this week need facility sign-off.</RecordNote>
          ) : (
            <ul aria-label="Sign-off by entry" className="flex flex-wrap gap-2">
              {signoffStates.map((item) => (
                <li key={item.state}>
                  <RefChip tone={FACILITY_STATE_TONE[item.state]} className="font-semibold">
                    {item.count} · {FACILITY_STATE_LABELS[item.state]}
                  </RefChip>
                </li>
              ))}
            </ul>
          )}
          {disputedEntries.length > 0 ? (
            <>
              <RecordNote>
                {canApprove
                  ? "Confirm the times stand, or correct the attendance from the entry's attendance history (that creates a new revision for re-approval)."
                  : "A facility has raised a discrepancy on these entries."}
              </RecordNote>
              <RecordList label="Facility discrepancies">
                {disputedEntries.map((entry) => {
                  const dispute = disputes.get(entry.id);
                  return (
                    <li key={entry.id} className={`${RECORD_ROW} flex-col items-start`}>
                      <span className={RECORD_ROW_TITLE}>
                        {entry.facilityName},{" "}
                        {formatShiftDate({
                          startAt: entry.scheduledStartAt,
                          timezone: entry.timezone,
                        })}
                        {dispute ? (
                          <span className="font-normal text-slate-600">
                            {" "}
                            · {reasonLabel(dispute.reasonCode) ?? ""}
                          </span>
                        ) : null}
                      </span>
                      {dispute?.note ? (
                        <span className={RECORD_ROW_META}>“{dispute.note}”</span>
                      ) : null}
                      {canApprove ? (
                        <ResolveDisputeForm
                          organisationId={organisationId}
                          timesheetId={sheet.id}
                          entryId={entry.id}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </RecordList>
            </>
          ) : approved && signoffStates.length > 0 ? (
            <RecordNote>No discrepancies raised.</RecordNote>
          ) : null}
        </Panel>
      ) : null}

      {isWorker ? (
        <Panel titleId="submission-heading" title={<>Submission</>}>
          {returnedNote}
          {blockingList}
          {canSubmit ? (
            <SubmitTimesheetForm organisationId={organisationId} timesheetId={sheet.id} />
          ) : !blockingList ? (
            <RecordNote>
              {sheet.status === "submitted"
                ? "Submitted. Your agency will review it."
                : approved
                  ? "Approved by your agency."
                  : "Nothing to submit yet."}
            </RecordNote>
          ) : null}
        </Panel>
      ) : (
        <Panel titleId="review-heading" title={<>Approval</>}>
          {returnedNote}
          {blockingList}
          {canApprove && sheet.status === "submitted" ? (
            <ApproveTimesheetForms
              organisationId={organisationId}
              timesheetId={sheet.id}
              revision={sheet.revision}
              canApprove={sheet.approvalBlockingReasons.length === 0}
            />
          ) : null}
          {canApprove && approved ? (
            <ReopenTimesheetForm organisationId={organisationId} timesheetId={sheet.id} />
          ) : null}
          {canApprove && !approved ? (
            <div className="w-fit">
              <InlineActionForm
                action={rebuildTimesheetAction}
                fields={{ organisationId, timesheetId: sheet.id }}
                label="Recalculate from attendance"
                variant="ghost"
              />
            </div>
          ) : null}
          {!canApprove || (sheet.status !== "submitted" && !approved) ? (
            <RecordNote>
              {sheet.status === "submitted"
                ? "Waiting for a reviewer with approval access."
                : sheet.status === "open"
                  ? "Waiting for the worker to submit."
                  : sheet.status === "rejected"
                    ? "Returned to the worker for correction."
                    : sheet.status === "agency_approved"
                      ? "Approved; facility sign-off is pending."
                      : "Approved and locked."}
            </RecordNote>
          ) : null}
        </Panel>
      )}

      <Panel titleId="timesheet-history-heading" title={<>Timesheet history</>}>
        {history.length === 0 ? (
          <EmptyState headingLevel={3} title="Nothing has happened yet." />
        ) : (
          <>
            <RecordNote>
              Append-only: every submission, decision and revision is kept.
              {sheet.revision > 1 ? ` Revision ${sheet.revision} is current.` : ""}
            </RecordNote>
            <ActivityTimeline
              label="Timesheet history"
              items={history.map((item, index) => ({
                id: `${item.action}-${item.occurredAt}-${index}`,
                title: (
                  <>
                    {HISTORY_ACTION_LABELS[item.action]}
                    {sheet.revision > 1 ? (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · Revision {item.revision}
                        {item.revision < sheet.revision ? " (superseded)" : ""}
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
          </>
        )}
      </Panel>
    </RecordPage>
  );
}
