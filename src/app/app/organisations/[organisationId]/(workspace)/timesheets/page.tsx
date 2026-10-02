import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  loadOrganisationPage,
  type OrganisationPageContext,
  StepUpNotice,
} from "@/features/organisations";
import {
  FacilityDecisionForms,
  FacilityStateBadge,
  listAgencyTimesheets,
  listFacilityTimesheetEntries,
  listMyTimesheets,
  timesheetFilterSchema,
  TimesheetStatusBadge,
} from "@/features/timesheets";
import { getMyWorkerRecord } from "@/features/workforce";
import { CAPABILITIES } from "@/lib/authz";
import { formatLocalClockTime } from "@/lib/domain/attendance";
import { formatShiftDate, formatShiftTimeRange } from "@/lib/domain/shifts";
import {
  blockingReasonLabel,
  DISPUTE_REASON_LABELS,
  formatPeriod,
  formatWorkedMinutes,
  TIMESHEET_STATUS_LABELS,
  TIMESHEET_STATUSES,
} from "@/lib/domain/timesheets";

export const metadata: Metadata = { title: "Timesheets" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

function Header({ context, intro }: { context: OrganisationPageContext; intro: string }) {
  return (
    <header className="flex flex-col gap-2">
      <Link
        href={`/app/organisations/${context.organisationId}`}
        className="w-fit text-sm text-primary underline underline-offset-4"
      >
        {context.organisation.name}
      </Link>
      <h1 className="text-2xl font-semibold">Timesheets</h1>
      <p className="max-w-2xl text-sm text-muted-foreground">{intro}</p>
    </header>
  );
}

/**
 * One route, three audiences: agency reviewers (timesheet.view), a worker
 * (their own weeks) and a linked facility (entries at its facility awaiting
 * sign-off). Each reads only its own projection.
 */
export default async function TimesheetsPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/timesheets">) {
  const context = await loadOrganisationPage((await params).organisationId);
  const { organisationId, organisation, can } = context;

  if (organisation.type === "facility") {
    const access = can(CAPABILITIES.TIMESHEET_FACILITY_SIGNOFF);
    if (access === "not_held") notFound();
    return <FacilityTimesheets context={context} />;
  }

  if (can(CAPABILITIES.TIMESHEET_VIEW) !== "not_held") {
    const raw = await searchParams;
    const filter = timesheetFilterSchema.parse({
      period: first(raw.period),
      status: first(raw.status),
    });
    const rows = await listAgencyTimesheets(organisationId, filter);
    return (
      <>
        <Header
          context={context}
          intro="Weekly timesheets derived from attendance. Worked time comes only from clock events and approved corrections; it cannot be typed in. Submitted timesheets and discrepancies are listed first."
        />
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="timesheet-period">Week starting</Label>
            <Input id="timesheet-period" name="period" type="date" defaultValue={filter.period} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="timesheet-status">Status</Label>
            <Select id="timesheet-status" name="status" defaultValue={filter.status ?? ""}>
              <option value="">Any status</option>
              {TIMESHEET_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {TIMESHEET_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="outline">
            Show
          </Button>
        </form>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No timesheets match.</p>
        ) : (
          <div
            role="region"
            aria-label="Agency timesheets table"
            tabIndex={0}
            className="overflow-x-auto rounded-lg border border-border bg-surface"
          >
            <table className="w-full min-w-[840px] text-left text-sm">
              <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Worker
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Week
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Worked
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Shifts
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Needs attention
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Facilities
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border align-top last:border-0">
                    <td className="px-3 py-2 font-medium">
                      <Link
                        href={`/app/organisations/${organisationId}/timesheets/${row.id}`}
                        className="text-primary underline underline-offset-4"
                      >
                        {row.workerName ?? "Worker"}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{formatPeriod(row.periodStart, row.periodEnd)}</td>
                    <td className="px-3 py-2">
                      <TimesheetStatusBadge status={row.status} />
                      {row.revision > 1 ? (
                        <div className="text-xs text-muted-foreground">Revision {row.revision}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatWorkedMinutes(row.totalWorkedMinutes)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.entryCount}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {row.issueCount > 0 ? (
                          <Badge tone="warning">
                            {row.issueCount === 1
                              ? "1 shift to resolve"
                              : `${row.issueCount} shifts to resolve`}
                          </Badge>
                        ) : null}
                        {row.disputedCount > 0 ? <Badge tone="danger">Discrepancy</Badge> : null}
                        {row.pendingFacilityCount > 0 ? (
                          <Badge tone="info">Awaiting facility</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.facilities.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  const worker = await getMyWorkerRecord(organisationId);
  if (!worker) notFound();
  const mine = await listMyTimesheets(organisationId);
  return (
    <>
      <Header
        context={context}
        intro="Your weekly timesheets, built from your clock-ins, clock-outs, breaks and approved corrections. Submit each week once it has ended."
      />
      {mine.length === 0 ? (
        <p className="text-sm text-muted-foreground">No timesheets yet.</p>
      ) : (
        <ul aria-label="My timesheets" className="flex flex-col gap-3">
          {mine.map((sheet) => (
            <li
              key={sheet.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/app/organisations/${organisationId}/timesheets/${sheet.id}`}
                  className="font-medium text-primary underline underline-offset-4"
                >
                  {formatPeriod(sheet.periodStart, sheet.periodEnd)}
                </Link>
                <TimesheetStatusBadge status={sheet.status} />
              </div>
              <p className="text-sm">
                {formatWorkedMinutes(sheet.totalWorkedMinutes)} worked ·{" "}
                {sheet.entryCount === 1 ? "1 shift" : `${sheet.entryCount} shifts`}
              </p>
              {sheet.canSubmit ? (
                <p className="text-sm font-medium text-primary">Ready to submit</p>
              ) : sheet.status === "open" || sheet.status === "rejected" ? (
                <ul aria-label="Before you can submit" className="flex flex-wrap gap-1">
                  {sheet.blockingReasons.map((reason) => (
                    <li key={reason}>
                      <Badge tone={reason === "PERIOD_NOT_ENDED" ? "neutral" : "warning"}>
                        {blockingReasonLabel(reason)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

async function FacilityTimesheets({ context }: { context: OrganisationPageContext }) {
  const { organisationId, can } = context;
  if (can(CAPABILITIES.TIMESHEET_FACILITY_SIGNOFF) !== "granted") {
    return (
      <>
        <Header
          context={context}
          intro="Worked time at your facility, approved by your agencies."
        />
        <StepUpNotice returnTo={`/app/organisations/${organisationId}/timesheets`} />
      </>
    );
  }
  const entries = await listFacilityTimesheetEntries(organisationId);
  return (
    <>
      <Header
        context={context}
        intro="Worked time at your facility that an agency has approved. Sign off each entry, or raise a discrepancy if something is wrong; you cannot change times here. Times are in the facility's timezone."
      />
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No entries awaiting sign-off.</p>
      ) : (
        <div
          role="region"
          aria-label="Facility timesheet entries"
          tabIndex={0}
          className="overflow-x-auto rounded-lg border border-border bg-surface"
        >
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Worker
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Date
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Scheduled
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Worked from – to
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Breaks
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Worked
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Sign-off
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const shift = {
                  startAt: entry.scheduledStartAt,
                  endAt: entry.scheduledEndAt,
                  timezone: entry.timezone,
                };
                const worker = entry.workerName ?? "Worker";
                return (
                  <tr key={entry.id} className="border-b border-border align-top last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{worker}</div>
                      <div className="text-muted-foreground">{entry.agencyName}</div>
                    </td>
                    <td className="px-3 py-2">
                      {formatShiftDate(shift)}
                      <div className="text-muted-foreground">
                        {entry.facilityName} · {entry.locationName}
                      </div>
                    </td>
                    <td className="px-3 py-2">{formatShiftTimeRange(shift)}</td>
                    <td className="px-3 py-2">
                      {formatLocalClockTime(entry.effectiveStartAt, entry.timezone)} –{" "}
                      {formatLocalClockTime(entry.effectiveEndAt, entry.timezone)}
                      {entry.hadAttendanceException ? (
                        <div className="text-xs text-muted-foreground">Reviewed by the agency</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatWorkedMinutes(entry.breakMinutes)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {formatWorkedMinutes(entry.workedMinutes)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-2">
                        <FacilityStateBadge state={entry.facilityState} />
                        {entry.disputeReason && entry.facilityState === "disputed" ? (
                          <span className="text-xs text-muted-foreground">
                            {DISPUTE_REASON_LABELS[entry.disputeReason]}
                          </span>
                        ) : null}
                        {entry.facilityState === "pending" ? (
                          <FacilityDecisionForms
                            organisationId={organisationId}
                            entryId={entry.id}
                            revision={entry.revision}
                            workerName={worker}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
