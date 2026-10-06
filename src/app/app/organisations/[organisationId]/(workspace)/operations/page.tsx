import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import {
  InitialsAvatar,
  RefChip,
  RefKpiCard,
  RefPanel,
} from "@/components/reference/locked-reference";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { SectionTabs } from "@/components/ui/section-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { loadOrganisationPage, requireCapabilityOrNotFound } from "@/features/organisations";
import {
  explainBlockReasons,
  listAssignmentIssues,
  listCredentialTypeNames,
  listDeliveryProblems,
  listRelationshipAffectedShifts,
  ShiftStatusBadge,
} from "@/features/shifts";
import { CAPABILITIES } from "@/lib/authz";
import {
  ASSIGNMENT_ISSUE_SEVERITY_LABELS,
  ASSIGNMENT_ISSUE_TYPE_LABELS,
  formatShiftDate,
  formatShiftTimeRange,
} from "@/lib/domain/shifts";
import { RELATIONSHIP_STATUS_LABELS } from "@/lib/domain/vocabulary";
import {
  deliveryErrorLabel,
  isNotificationEvent,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_STATE_LABELS,
  NOTIFICATION_STATES,
} from "@/lib/notifications/vocabulary";

import { AttentionDetailsPanel } from "./_components/attention-details-panel";
import { AttentionHeader, AttentionRow, relativeTime } from "./_components/attention-row";

export const metadata: Metadata = { title: "Operations" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

function stateLabel(state: string): string {
  const known = NOTIFICATION_STATES.find((value) => value === state);
  return known ? NOTIFICATION_STATE_LABELS[known] : state;
}

/**
 * Operations — the current operational attention centre (P0-E8-S9G, option
 * C). Same loaders and gates as before, presented in the locked Notifications
 * list language: only real, actionable items, each deep-linking to its
 * authoritative record. Not a notification inbox: there is no read, unread or
 * archive state, and nothing is dismissed here.
 */
export default async function OperationsPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/operations">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.ASSIGNMENT_VIEW);
  const { organisationId, organisation, can } = context;
  if (organisation.type !== "agency") notFound();

  const canSeeIssues =
    can(CAPABILITIES.ASSIGNMENT_VIEW) === "granted" &&
    can(CAPABILITIES.COMPLIANCE_VIEW) === "granted";
  const [issues, affected, deliveries, typeNames] = await Promise.all([
    canSeeIssues ? listAssignmentIssues(organisationId) : Promise.resolve([]),
    can(CAPABILITIES.SHIFT_VIEW) === "granted"
      ? listRelationshipAffectedShifts(organisationId)
      : Promise.resolve([]),
    listDeliveryProblems(organisationId),
    listCredentialTypeNames(),
  ]);
  const shiftLink = (shiftId: string) =>
    `/app/organisations/${organisationId}/shifts/${shiftId}` as Route;
  const base = `/app/organisations/${organisationId}/operations` as const;
  const urgent = issues.filter((issue) => issue.severity === "urgent").length;
  const failed = deliveries.filter((delivery) => delivery.state === "failed").length;
  const reasonsOf = (issue: (typeof issues)[number]) =>
    issue.issueType === "not_eligible"
      ? explainBlockReasons(
          issue.blockReasons,
          issue.complianceReasons.map((reason) => ({
            scope: "agency",
            credentialTypeKey: null,
            reason,
            severity: "blocking",
            evaluationDate: "",
            effectiveExpiryDate: null,
          })),
          typeNames,
        )
      : [];

  return (
    <div className="chelth-locked flex flex-col gap-[13px]">
      <PageHeader
        variant="reference"
        className="xl:mb-1"
        title="Operations"
        description={
          <p>
            Upcoming work that needs a decision. Chelth re-checks upcoming assignments every hour.
          </p>
        }
      />

      {/* Locked: with Attention Details open on wide screens the work area contracts beside it. */}
      <div className="flex flex-col gap-[13px] min-[1536px]:has-[dialog[open]]:pr-[407px]">
        <section
          aria-label="Operations attention"
          className="grid grid-cols-2 gap-3 xl:grid-cols-3 xl:gap-[9px]"
        >
          {canSeeIssues ? (
            <RefKpiCard
              size="sm"
              label="Needs Attention"
              value={issues.length}
              supporting={`${urgent} urgent`}
              glyph="alert"
              icon={<WorkspaceNavIcon name="operations" strokeWidth={2.4} duotone />}
              tone="danger"
              href={`${base}#attention-heading` as Route}
            />
          ) : null}
          <RefKpiCard
            size="sm"
            label="Inactive Relationships"
            value={affected.length}
            supporting="Upcoming shifts affected"
            glyph="building"
            icon={<WorkspaceNavIcon name="facilities" strokeWidth={2.4} duotone />}
            tone="warning"
            href={`${base}#affected-heading` as Route}
          />
          <RefKpiCard
            size="sm"
            label="Emails Not Delivered"
            value={deliveries.length}
            supporting={`${failed} failed`}
            glyph="document"
            icon={<WorkspaceNavIcon name="requests" strokeWidth={2.4} duotone />}
            tone="info"
            href={`${base}#delivery-heading` as Route}
          />
        </section>

        <SectionTabs
          label="Operations sections"
          tabs={[
            ...(canSeeIssues
              ? [
                  {
                    label: "Needs attention",
                    href: "#attention-heading" as Route,
                    current: false,
                    count: issues.length,
                  },
                ]
              : []),
            {
              label: "Inactive relationships",
              href: "#affected-heading" as Route,
              current: false,
              count: affected.length,
            },
            {
              label: "Email delivery",
              href: "#delivery-heading" as Route,
              current: false,
              count: deliveries.length,
            },
          ]}
        />

        {canSeeIssues ? (
          <RefPanel
            title="Assignments needing attention"
            titleId="attention-heading"
            action={
              urgent > 0 ? (
                <RefChip tone="danger" className="font-semibold">
                  {urgent} urgent
                </RefChip>
              ) : undefined
            }
          >
            {issues.length === 0 ? (
              <OperationsEmpty
                title="Nothing needs attention right now."
                note="Assignments appear here when a worker is no longer eligible or a facility relationship is not active."
              />
            ) : (
              <div className="mt-[9px] flex flex-col">
                <AttentionHeader related="Related to" />
                <ul
                  aria-label="Assignments needing attention"
                  className="flex flex-col divide-y divide-[rgba(18,107,103,0.10)]"
                >
                  {issues.map((issue) => {
                    const isUrgent = issue.severity === "urgent";
                    const worker = issue.workerName ?? "Worker";
                    const reasons = reasonsOf(issue);
                    return (
                      <AttentionRow
                        key={issue.id}
                        tone={isUrgent ? "danger" : "warning"}
                        icon="operations"
                        title={
                          <Link
                            href={shiftLink(issue.shiftId)}
                            className="hover:text-primary hover:underline hover:underline-offset-4"
                          >
                            {ASSIGNMENT_ISSUE_TYPE_LABELS[issue.issueType]}
                          </Link>
                        }
                        explanation={
                          <>
                            {worker} · {issue.facilityName} · {formatShiftDate(issue)},{" "}
                            {formatShiftTimeRange(issue)}
                            {reasons[0] ? <span className="block">{reasons[0]}</span> : null}
                          </>
                        }
                        related={
                          <span className="flex items-center gap-2.5">
                            <InitialsAvatar name={issue.workerName} />
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate font-medium text-chelth-navy">
                                {worker}
                              </span>
                              <span className="truncate text-[12px]">{issue.facilityName}</span>
                            </span>
                          </span>
                        }
                        time={
                          <>
                            <span className="sr-only">Opened </span>
                            <time
                              dateTime={issue.openedAt}
                              title={dateTime.format(new Date(issue.openedAt))}
                            >
                              {relativeTime(issue.openedAt)}
                            </time>
                            <span className="block text-[11.5px] text-muted-foreground">
                              Checked {relativeTime(issue.lastEvaluatedAt)}
                            </span>
                          </>
                        }
                        status={
                          <RefChip tone={isUrgent ? "danger" : "warning"} className="font-normal">
                            {ASSIGNMENT_ISSUE_SEVERITY_LABELS[issue.severity]}
                          </RefChip>
                        }
                        action={
                          <DetailDrawerTrigger
                            triggerLabel="⋮"
                            triggerClassName="justify-center px-2 text-xl font-bold text-chelth-navy no-underline sm:min-h-9"
                            triggerAccessibleLabel={`Details for ${worker}, ${ASSIGNMENT_ISSUE_TYPE_LABELS[issue.issueType]}`}
                            title="Attention Details"
                            width="profile"
                          >
                            <AttentionDetailsPanel
                              issue={issue}
                              reasons={reasons}
                              shiftHref={shiftLink(issue.shiftId)}
                            />
                          </DetailDrawerTrigger>
                        }
                      />
                    );
                  })}
                </ul>
              </div>
            )}
          </RefPanel>
        ) : null}

        <RefPanel title="Upcoming work under inactive relationships" titleId="affected-heading">
          {affected.length === 0 ? (
            <OperationsEmpty
              title="No affected upcoming work."
              note="Shifts appear here when a facility relationship is suspended or ended."
            />
          ) : (
            <div className="mt-[9px] flex flex-col">
              <AttentionHeader related="Facility" />
              <ul
                aria-label="Affected upcoming shifts"
                className="flex flex-col divide-y divide-[rgba(18,107,103,0.10)]"
              >
                {affected.map((shift) => (
                  <AttentionRow
                    key={shift.id}
                    tone="warning"
                    icon="facilities"
                    title={
                      <Link
                        href={shiftLink(shift.id)}
                        className="hover:text-primary hover:underline hover:underline-offset-4"
                      >
                        Relationship{" "}
                        {RELATIONSHIP_STATUS_LABELS[shift.relationshipStatus].toLowerCase()}
                      </Link>
                    }
                    explanation={`${formatShiftTimeRange(shift)} · ${shift.activeCount} assigned`}
                    related={
                      <span className="font-medium text-chelth-navy">{shift.facilityName}</span>
                    }
                    time={formatShiftDate(shift)}
                    status={<ShiftStatusBadge status={shift.status} />}
                    action={
                      <Link
                        href={shiftLink(shift.id)}
                        className="inline-flex min-h-11 items-center text-[13px] font-semibold whitespace-nowrap text-primary underline underline-offset-4 sm:min-h-9"
                      >
                        View shift
                        <span className="sr-only">
                          {" "}
                          at {shift.facilityName}, {formatShiftDate(shift)}
                        </span>
                      </Link>
                    }
                  />
                ))}
              </ul>
            </div>
          )}
        </RefPanel>

        <RefPanel title="Notifications not delivered" titleId="delivery-heading">
          <p className="max-w-[68ch] px-[5px] pt-1 text-[13.5px] leading-[21px] text-slate-600">
            Emails to members of {organisation.name} that are retrying or failed.
          </p>
          {deliveries.length === 0 ? (
            <OperationsEmpty
              title="All notifications delivered."
              note="Retrying or failed emails appear here."
            />
          ) : (
            <div className="mt-[9px] flex flex-col">
              <AttentionHeader related="Recipient" />
              <ul
                aria-label="Undelivered notifications"
                className="flex flex-col divide-y divide-[rgba(18,107,103,0.10)]"
              >
                {deliveries.map((delivery) => (
                  <AttentionRow
                    key={delivery.id}
                    tone={delivery.state === "failed" ? "danger" : "warning"}
                    icon="requests"
                    title={
                      isNotificationEvent(delivery.event)
                        ? NOTIFICATION_EVENT_LABELS[delivery.event]
                        : delivery.event
                    }
                    explanation={
                      <>
                        {deliveryErrorLabel(delivery.lastErrorCode)} · {delivery.attempts}{" "}
                        {delivery.attempts === 1 ? "attempt" : "attempts"}
                        {delivery.state === "retry"
                          ? ` · next attempt ${dateTime.format(new Date(delivery.nextAttemptAt))}`
                          : ""}
                      </>
                    }
                    related={
                      <span className="flex items-center gap-2.5">
                        <InitialsAvatar name={delivery.recipientName} />
                        <span className="truncate font-medium text-chelth-navy">
                          {delivery.recipientName ?? "A member"}
                        </span>
                      </span>
                    }
                    time={
                      <time
                        dateTime={delivery.createdAt}
                        title={dateTime.format(new Date(delivery.createdAt))}
                      >
                        {relativeTime(delivery.createdAt)}
                      </time>
                    }
                    status={
                      <RefChip
                        tone={delivery.state === "failed" ? "danger" : "warning"}
                        className="font-normal"
                      >
                        {stateLabel(delivery.state)}
                      </RefChip>
                    }
                    action={
                      delivery.shiftId ? (
                        <Link
                          href={shiftLink(delivery.shiftId)}
                          className="inline-flex min-h-11 items-center text-[13px] font-semibold whitespace-nowrap text-primary underline underline-offset-4 sm:min-h-9"
                        >
                          View shift
                          <span className="sr-only">
                            {" "}
                            for{" "}
                            {isNotificationEvent(delivery.event)
                              ? NOTIFICATION_EVENT_LABELS[delivery.event]
                              : delivery.event}
                          </span>
                        </Link>
                      ) : null
                    }
                  />
                ))}
              </ul>
            </div>
          )}
        </RefPanel>
      </div>
    </div>
  );
}

/** Deliberate empty state inside a reference panel. */
function OperationsEmpty({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-center gap-3 px-[5px] py-3">
      <span
        aria-hidden="true"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-muted text-muted-foreground [&>svg]:size-[19px]"
      >
        <WorkspaceNavIcon name="operations" strokeWidth={2} />
      </span>
      <span className="flex flex-col">
        <span className="text-[14px] leading-5 font-medium text-slate-600">{title}</span>
        <span className="text-[12.5px] leading-[18px] text-muted-foreground">{note}</span>
      </span>
    </div>
  );
}
