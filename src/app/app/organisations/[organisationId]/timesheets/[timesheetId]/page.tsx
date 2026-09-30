import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { Badge } from "@/components/ui/badge";
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
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}/timesheets`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          Timesheets
        </Link>
        <h1 className="text-2xl font-semibold">
          {isWorker ? "My timesheet" : (sheet.workerName ?? "Worker")}
        </h1>
        <p className="text-sm text-muted-foreground">
          Week {formatPeriod(sheet.periodStart, sheet.periodEnd)}
          {sheet.revision > 1 ? ` · Revision ${sheet.revision}` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <TimesheetStatusBadge status={sheet.status} />
          {sheet.approvedByName && sheet.agencyApprovedAt ? (
            <span className="text-sm text-muted-foreground">
              Approved by {sheet.approvedByName}, {when.format(new Date(sheet.agencyApprovedAt))}
            </span>
          ) : null}
        </div>
      </header>

      <dl className="grid max-w-lg grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
        <dt className="text-muted-foreground">Worked</dt>
        <dd className="font-semibold tabular-nums">
          {formatWorkedMinutes(sheet.totalWorkedMinutes)}
        </dd>
        <dt className="text-muted-foreground">Breaks</dt>
        <dd className="tabular-nums">{formatWorkedMinutes(sheet.totalBreakMinutes)}</dd>
        <dt className="text-muted-foreground">Shifts</dt>
        <dd className="tabular-nums">{sheet.entryCount}</dd>
      </dl>

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
        <section aria-labelledby="blocking-heading" className="flex flex-col gap-2">
          <h2 id="blocking-heading" className="text-lg font-semibold">
            {isWorker ? "Before you can submit" : "Before this can be approved"}
          </h2>
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
        </section>
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

      <section aria-labelledby="entries-heading" className="flex flex-col gap-3">
        <h2 id="entries-heading" className="text-lg font-semibold">
          Shifts
        </h2>
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
      </section>

      {canApprove && disputedEntries.length > 0 ? (
        <section aria-labelledby="disputes-heading" className="flex flex-col gap-3">
          <h2 id="disputes-heading" className="text-lg font-semibold">
            Facility discrepancies
          </h2>
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
        </section>
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

      <section aria-labelledby="timesheet-history-heading" className="flex flex-col gap-3">
        <h2 id="timesheet-history-heading" className="text-lg font-semibold">
          Timesheet history
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>
        ) : (
          <ol aria-label="Timesheet history" className="flex flex-col gap-2 text-sm">
            {history.map((item, index) => (
              <li
                key={`${item.action}-${item.occurredAt}-${index}`}
                className="flex flex-wrap items-baseline gap-x-2 border-b border-border pb-2 last:border-0"
              >
                <span className="text-muted-foreground tabular-nums">
                  {when.format(new Date(item.occurredAt))}
                </span>
                <span className="font-medium">{HISTORY_ACTION_LABELS[item.action]}</span>
                {item.revision > 1 ? <Badge tone="neutral">Revision {item.revision}</Badge> : null}
                {reasonLabel(item.reasonCode) ? (
                  <span className="text-muted-foreground">{reasonLabel(item.reasonCode)}</span>
                ) : null}
                {item.actorName ? (
                  <span className="text-muted-foreground">· {item.actorName}</span>
                ) : null}
                {item.note ? (
                  <span className="basis-full text-muted-foreground">“{item.note}”</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
