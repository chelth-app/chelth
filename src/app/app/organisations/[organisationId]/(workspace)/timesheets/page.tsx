import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import {
  InitialsAvatar,
  REF_TABLE,
  REF_TEXT,
  RefChip,
  RefKpiCard,
  RefPanel,
} from "@/components/reference/locked-reference";
import { DataTableRegion } from "@/components/ui/data-table";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { PageHeader } from "@/components/ui/page-header";
import { loadOrganisationPage, type OrganisationPageContext } from "@/features/organisations";
import {
  FacilityDecisionForms,
  listFacilityTimesheetEntries,
  listMyTimesheets,
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
  FACILITY_STATE_LABELS,
  formatWorkedMinutes,
  type TimesheetFacilityState,
} from "@/lib/domain/timesheets";
import { cn } from "@/lib/utils/cn";

import {
  FactRows,
  INK,
  StatePanel,
  WORKER_CARD,
  WORKER_PRIMARY_CTA,
  WORKER_SECONDARY_CTA,
  WorkerEmpty,
  WorkerIconTile,
} from "../../(self-service)/my-shifts/_components/worker-cards";
import { LockedEmpty, LockedFilterSelect } from "../(finance)/_components/finance-locked";
import { FacilityStepUpNotice } from "../_components/facility-step-up-notice";
import { AgencyTimesheets } from "./_components/agency-timesheets";
import {
  FACILITY_STATE_TONE,
  FacilityEntryDetailsPanel,
} from "./_components/facility-entry-details-panel";

export const metadata: Metadata = { title: "Timesheets" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
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
    return <FacilityTimesheets context={context} rawState={first((await searchParams).state)} />;
  }

  if (can(CAPABILITIES.TIMESHEET_VIEW) !== "not_held") {
    return <AgencyTimesheets context={context} raw={await searchParams} />;
  }

  const worker = await getMyWorkerRecord(organisationId);
  if (!worker) notFound();
  const mine = await listMyTimesheets(organisationId);
  return <WorkerTimesheets organisationId={organisationId} timesheets={mine} />;
}

/**
 * The worker's own weeks (P0-E8-QA-F2): the W1 worker card language inside
 * the worker shell. Worked time only, from attendance — never pay, bill or
 * payroll values. Submission stays on the timesheet record.
 */
function WorkerTimesheets({
  organisationId,
  timesheets,
}: {
  organisationId: string;
  timesheets: Awaited<ReturnType<typeof listMyTimesheets>>;
}) {
  return (
    <div className="chelth-locked flex flex-col gap-6">
      <PageHeader
        variant="reference"
        title="Timesheets"
        description={
          <p>
            Your weekly timesheets, built from your clock-ins, clock-outs, breaks and approved
            corrections. Submit each week once it has ended.
          </p>
        }
      />
      {timesheets.length === 0 ? (
        <WorkerEmpty
          icon="timesheets"
          title="No timesheets yet."
          note="Your completed attendance will appear here when a weekly timesheet is available."
        />
      ) : (
        <ul aria-label="My timesheets" className="flex flex-col gap-3">
          {timesheets.map((sheet) => {
            const period = formatPeriod(sheet.periodStart, sheet.periodEnd);
            const blocked =
              !sheet.canSubmit && (sheet.status === "open" || sheet.status === "rejected");
            return (
              <li key={sheet.id} className={WORKER_CARD}>
                <div className="flex items-start gap-3">
                  <WorkerIconTile icon="timesheets" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className={cn("text-[16px] leading-[22px] font-semibold", INK)}>{period}</p>
                    <p className="text-[13px] leading-[18px] text-slate-600">Weekly timesheet</p>
                    <div className="mt-0.5 flex flex-wrap gap-1.5">
                      <TimesheetStatusBadge status={sheet.status} />
                    </div>
                  </div>
                </div>
                <FactRows
                  rows={[
                    {
                      icon: "attendance",
                      label: "Worked",
                      value: (
                        <>
                          <span className={cn("font-semibold tabular-nums", INK)}>
                            {formatWorkedMinutes(sheet.totalWorkedMinutes)}
                          </span>{" "}
                          worked ·{" "}
                          {sheet.entryCount === 1 ? "1 shift" : `${sheet.entryCount} shifts`}
                          <span className="block text-[12.5px] leading-[18px] text-slate-600">
                            From your attendance — not typed in
                          </span>
                        </>
                      ),
                    },
                  ]}
                />
                {sheet.canSubmit ? (
                  <StatePanel tone="success" title="Ready to submit">
                    <p className="text-slate-700">Check the week, then submit it to your agency.</p>
                  </StatePanel>
                ) : blocked ? (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-[13px] leading-[18px] font-medium text-slate-600">
                      Before you can submit
                    </p>
                    <ul aria-label="Before you can submit" className="flex flex-wrap gap-1.5">
                      {sheet.blockingReasons.map((reason) => (
                        <li key={reason} className="max-w-full">
                          <RefChip
                            tone={reason === "PERIOD_NOT_ENDED" ? "neutral" : "warning"}
                            className="h-auto min-h-[26px] py-1 font-semibold whitespace-normal"
                          >
                            {blockingReasonLabel(reason)}
                          </RefChip>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <Link
                  href={`/app/organisations/${organisationId}/timesheets/${sheet.id}` as Route}
                  aria-label={`${sheet.canSubmit ? "Review and submit" : "View timesheet"}, week ${period}`}
                  className={sheet.canSubmit ? WORKER_PRIMARY_CTA : WORKER_SECONDARY_CTA}
                >
                  {sheet.canSubmit ? "Review and submit" : "View timesheet"}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Facility sign-off header (P0-E8-QA-F1): the locked reference treatment. */
function FacilityHeader({ context, intro }: { context: OrganisationPageContext; intro: string }) {
  return (
    <PageHeader
      variant="reference"
      className="xl:mb-1"
      title="Timesheets"
      back={
        <Link
          href={`/app/organisations/${context.organisationId}`}
          className="text-primary underline underline-offset-4"
        >
          {context.organisation.name}
        </Link>
      }
      description={<p>{intro}</p>}
    />
  );
}

/**
 * Facility sign-off (P0-E8-QA-F1): the locked Timesheets family over the
 * facility's own projection — no pay, rates, payroll or coordinates. The
 * sign-off and discrepancy forms and their capability gate are unchanged.
 */
async function FacilityTimesheets({
  context,
  rawState,
}: {
  context: OrganisationPageContext;
  rawState: string | undefined;
}) {
  const { organisationId, can } = context;
  if (can(CAPABILITIES.TIMESHEET_FACILITY_SIGNOFF) !== "granted") {
    return (
      <div className="chelth-locked flex flex-col gap-[13px]">
        <FacilityHeader
          context={context}
          intro="Worked time at your facility, approved by your agencies."
        />
        <FacilityStepUpNotice returnTo={`/app/organisations/${organisationId}/timesheets`} />
      </div>
    );
  }
  const entries = await listFacilityTimesheetEntries(organisationId);
  // Display filter over the facility's own (already loaded) projection.
  const states = Object.keys(FACILITY_STATE_LABELS) as TimesheetFacilityState[];
  const stateFilter = states.find((state) => state === rawState);
  const shown = stateFilter
    ? entries.filter((entry) => entry.facilityState === stateFilter)
    : entries;
  const base = `/app/organisations/${organisationId}/timesheets` as const;
  const quick = (state: TimesheetFacilityState) => ({
    count: entries.filter((entry) => entry.facilityState === state).length,
    href: `${base}?state=${state}` as Route,
    active: stateFilter === state,
  });
  const pending = quick("pending");
  const signedOff = quick("signed_off");
  const disputed = quick("disputed");
  return (
    <div className="chelth-locked flex flex-col gap-[13px]">
      <FacilityHeader
        context={context}
        intro="Worked time at your facility that an agency has approved. Sign off each entry, or raise a discrepancy if something is wrong; you cannot change times here. Times are in the facility's timezone."
      />
      {/* Locked: with Timesheet Details open on wide screens the work area contracts beside it. */}
      <div className="flex flex-col gap-[13px] min-[1536px]:has-[dialog[open]]:pr-[407px]">
        {entries.length > 0 ? (
          <>
            <section
              aria-label="Sign-off summary"
              className="grid grid-cols-2 gap-3 xl:grid-cols-3 xl:gap-[13px]"
            >
              <RefKpiCard
                size="sm"
                label="Awaiting Sign-off"
                value={pending.count}
                supporting="Approved by the agency"
                glyph="document"
                icon={<WorkspaceNavIcon name="timesheets" strokeWidth={2.4} duotone />}
                tone="info"
                href={pending.href}
                active={pending.active}
              />
              <RefKpiCard
                size="sm"
                label="Signed Off"
                value={signedOff.count}
                supporting="Confirmed by your facility"
                glyph="document"
                icon={<WorkspaceNavIcon name="compliance" strokeWidth={2.4} duotone />}
                tone="teal"
                href={signedOff.href}
                active={signedOff.active}
              />
              <RefKpiCard
                size="sm"
                label="Discrepancies Raised"
                value={disputed.count}
                supporting="Waiting for the agency"
                glyph="alert"
                icon={<WorkspaceNavIcon name="attendance" strokeWidth={2.4} duotone />}
                tone={disputed.count > 0 ? "danger" : "teal"}
                href={disputed.href}
                active={disputed.active}
              />
            </section>
            <form
              key={stateFilter ?? "all"}
              aria-label="Filter entries"
              method="get"
              className="flex flex-wrap items-center gap-[9px]"
            >
              <LockedFilterSelect
                id="entry-state"
                name="state"
                label="Sign-off"
                value={stateFilter ?? ""}
                className="xl:w-[220px]"
                icon={<WorkspaceNavIcon name="timesheets" />}
              >
                <option value="">All entries</option>
                {states.map((state) => (
                  <option key={state} value={state}>
                    {FACILITY_STATE_LABELS[state]}
                  </option>
                ))}
              </LockedFilterSelect>
              <button
                type="submit"
                className="inline-flex h-11 items-center rounded-md border border-chelth-border bg-white/90 px-4 text-[13.5px] font-medium text-chelth-navy hover:bg-surface-muted sm:h-[46px]"
              >
                Apply filters
              </button>
              {stateFilter ? (
                <Link
                  href={base}
                  className="inline-flex min-h-11 items-center px-1 text-[13px] font-medium text-primary underline underline-offset-4"
                >
                  Clear filters
                </Link>
              ) : null}
            </form>
          </>
        ) : null}

        <RefPanel
          title="Entries for Sign-off"
          titleId="facility-entries-heading"
          action={
            entries.length > 0 ? (
              <span className="text-[13.5px] text-muted-foreground">
                {shown.length === 1 ? "1 entry" : `${shown.length} entries`}
              </span>
            ) : undefined
          }
        >
          {entries.length === 0 ? (
            <LockedEmpty
              icon="timesheets"
              title="No entries awaiting sign-off."
              note="Worked time appears here once an agency approves it."
            />
          ) : shown.length === 0 ? (
            <LockedEmpty
              icon="timesheets"
              title="No entries in this state."
              note="Change the sign-off filter to see other entries."
            >
              <Link
                href={base}
                className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4"
              >
                Show all entries
              </Link>
            </LockedEmpty>
          ) : (
            <DataTableRegion
              aria-label="Facility timesheet entries"
              className="mt-[9px] rounded-none border-0 bg-transparent"
            >
              <table className={cn(REF_TABLE, "min-w-[960px] table-fixed")}>
                <colgroup>
                  <col className="w-[18%]" />
                  <col className="w-[17%]" />
                  <col className="w-[14%]" />
                  <col className="w-[13%]" />
                  <col className="w-[7%]" />
                  <col className="w-[8%]" />
                  <col className="w-[19%]" />
                  <col className="w-[4%]" />
                </colgroup>
                <thead className={REF_TEXT.tableHead}>
                  <tr>
                    <th scope="col">Worker</th>
                    <th scope="col">Date</th>
                    <th scope="col">Scheduled</th>
                    <th scope="col">Worked From – To</th>
                    <th scope="col" className="text-right">
                      Breaks
                    </th>
                    <th scope="col" className="text-right">
                      Worked
                    </th>
                    <th scope="col" className="pl-5!">
                      Sign-off
                    </th>
                    <th scope="col">
                      <span className="sr-only">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="text-[13px] leading-[18px] text-slate-600">
                  {shown.map((entry) => {
                    const shift = {
                      startAt: entry.scheduledStartAt,
                      endAt: entry.scheduledEndAt,
                      timezone: entry.timezone,
                    };
                    const worker = entry.workerName ?? "Worker";
                    return (
                      <tr
                        key={entry.id}
                        className="align-top transition-colors hover:bg-surface-muted/50 has-[dialog[open]]:bg-chelth-mint-mist/70 [&:has(dialog[open])>*:first-child]:shadow-[inset_3px_0_0_var(--chelth-teal)]"
                      >
                        <td className="py-3">
                          <span className="flex items-center gap-2.5">
                            <InitialsAvatar name={entry.workerName} />
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate font-medium text-chelth-navy">
                                {worker}
                              </span>
                              <span className="truncate text-muted-foreground">
                                {entry.agencyName}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td className="py-3">
                          {formatShiftDate(shift)}
                          <span className="block truncate text-muted-foreground">
                            {entry.facilityName} · {entry.locationName}
                          </span>
                        </td>
                        <td className="py-3">{formatShiftTimeRange(shift)}</td>
                        <td className="py-3">
                          {formatLocalClockTime(entry.effectiveStartAt, entry.timezone)} –{" "}
                          {formatLocalClockTime(entry.effectiveEndAt, entry.timezone)}
                          {entry.hadAttendanceException ? (
                            <span className="block text-[11.5px] text-muted-foreground">
                              Reviewed by the agency
                            </span>
                          ) : null}
                        </td>
                        <td className="py-3 text-right tabular-nums">
                          {formatWorkedMinutes(entry.breakMinutes)}
                        </td>
                        <td className="py-3 text-right font-medium text-chelth-navy tabular-nums">
                          {formatWorkedMinutes(entry.workedMinutes)}
                        </td>
                        <td className="py-3 pl-5!">
                          <span className="flex flex-col items-start gap-2">
                            <RefChip
                              tone={FACILITY_STATE_TONE[entry.facilityState]}
                              className="font-normal"
                            >
                              {FACILITY_STATE_LABELS[entry.facilityState]}
                            </RefChip>
                            {entry.disputeReason && entry.facilityState === "disputed" ? (
                              <span className="text-[11.5px] text-muted-foreground">
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
                          </span>
                        </td>
                        <td className="py-2 text-right">
                          <DetailDrawerTrigger
                            triggerLabel="⋮"
                            triggerClassName="justify-center px-2 text-xl font-bold text-chelth-navy no-underline sm:min-h-9"
                            triggerAccessibleLabel={`Details for ${worker}, ${formatShiftDate(shift)}`}
                            title="Timesheet Details"
                            width="profile"
                          >
                            <FacilityEntryDetailsPanel entry={entry} />
                          </DetailDrawerTrigger>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DataTableRegion>
          )}
        </RefPanel>
      </div>
    </div>
  );
}
