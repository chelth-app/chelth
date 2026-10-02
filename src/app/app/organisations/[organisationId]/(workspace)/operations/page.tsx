import type { Metadata, Route } from "next";
import Link from "next/link";

import { Panel } from "@/components/ui/panel";
import { notFound } from "next/navigation";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiFilterCard, KpiFilterGroup } from "@/components/ui/kpi-filter-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
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
  ASSIGNMENT_STATUS_LABELS,
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

export const metadata: Metadata = { title: "Operations" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

function stateLabel(state: string): string {
  const known = NOTIFICATION_STATES.find((value) => value === state);
  return known ? NOTIFICATION_STATE_LABELS[known] : state;
}

/**
 * Operational attention: only real, actionable items. No scores or rankings.
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
    `/app/organisations/${organisationId}/shifts/${shiftId}` as const;

  return (
    <>
      <PageHeader
        title="Operations"
        back={
          <Link
            href={`/app/organisations/${organisationId}`}
            className="text-primary underline underline-offset-4"
          >
            {organisation.name}
          </Link>
        }
        description={
          <p>
            Upcoming work that needs a decision. Chelth re-checks upcoming assignments every hour.
          </p>
        }
      />

      <KpiFilterGroup label="Operations attention">
        {canSeeIssues ? (
          <KpiFilterCard
            label="Assignments needing attention"
            value={issues.length}
            supporting={`${issues.filter((issue) => issue.severity === "urgent").length} urgent`}
            icon={<WorkspaceNavIcon name="operations" />}
            href={`/app/organisations/${organisationId}/operations#attention-heading` as Route}
          />
        ) : null}
        <KpiFilterCard
          label="Work under inactive relationships"
          value={affected.length}
          supporting="Upcoming shifts"
          icon={<WorkspaceNavIcon name="facilities" />}
          href={`/app/organisations/${organisationId}/operations#affected-heading` as Route}
        />
        <KpiFilterCard
          label="Notifications not delivered"
          value={deliveries.length}
          supporting={`${deliveries.filter((delivery) => delivery.state === "failed").length} failed`}
          icon={<WorkspaceNavIcon name="requests" />}
          href={`/app/organisations/${organisationId}/operations#delivery-heading` as Route}
        />
      </KpiFilterGroup>

      {canSeeIssues ? (
        <Panel titleId="attention-heading" title={<>Assignments needing attention</>}>
          {issues.length === 0 ? (
            <EmptyState headingLevel={3} title="Nothing needs attention." />
          ) : (
            <ul aria-label="Assignments needing attention" className="flex flex-col gap-3">
              {issues.map((issue) => (
                <li key={issue.id} className="flex flex-col gap-2 rounded-md bg-surface-muted p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={shiftLink(issue.shiftId)}
                      className="font-medium text-primary underline underline-offset-4"
                    >
                      {issue.workerName ?? "Worker"} · {issue.facilityName} ·{" "}
                      {formatShiftDate(issue)}
                    </Link>
                    <div className="flex flex-wrap gap-2">
                      <StatusChip tone={issue.severity === "urgent" ? "danger" : "attention"}>
                        {ASSIGNMENT_ISSUE_SEVERITY_LABELS[issue.severity]}
                      </StatusChip>
                      <StatusChip tone="neutral">
                        {ASSIGNMENT_STATUS_LABELS[issue.assignmentStatus]}
                      </StatusChip>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {ASSIGNMENT_ISSUE_TYPE_LABELS[issue.issueType]} · {formatShiftTimeRange(issue)}{" "}
                    · last checked {dateTime.format(new Date(issue.lastEvaluatedAt))}
                  </p>
                  {issue.issueType === "not_eligible" ? (
                    <ul className="list-disc pl-5 text-sm">
                      {explainBlockReasons(
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
                      ).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      <Panel titleId="affected-heading" title={<>Upcoming work under inactive relationships</>}>
        {affected.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No affected upcoming work."
            description="Shifts appear here when a facility relationship is suspended or ended."
          />
        ) : (
          <ul aria-label="Affected upcoming shifts" className="flex flex-col gap-2">
            {affected.map((shift) => (
              <li
                key={shift.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-muted p-3 text-sm"
              >
                <Link
                  href={shiftLink(shift.id)}
                  className="text-primary underline underline-offset-4"
                >
                  {shift.facilityName} · {formatShiftDate(shift)} · {formatShiftTimeRange(shift)}
                </Link>
                <span className="flex flex-wrap gap-2">
                  <ShiftStatusBadge status={shift.status} />
                  <StatusChip tone="warning">
                    Relationship{" "}
                    {RELATIONSHIP_STATUS_LABELS[shift.relationshipStatus].toLowerCase()}
                  </StatusChip>
                  <Badge tone="neutral">{shift.activeCount} assigned</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel titleId="delivery-heading" title={<>Notifications not delivered</>}>
        <p className="text-sm text-muted-foreground">
          Emails to members of {organisation.name} that are retrying or failed.
        </p>
        {deliveries.length === 0 ? (
          <EmptyState headingLevel={3} title="All notifications delivered." />
        ) : (
          <ul aria-label="Undelivered notifications" className="flex flex-col gap-2">
            {deliveries.map((delivery) => (
              <li
                key={delivery.id}
                className="flex flex-col gap-1 rounded-md bg-surface-muted p-3 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {isNotificationEvent(delivery.event)
                      ? NOTIFICATION_EVENT_LABELS[delivery.event]
                      : delivery.event}
                  </span>
                  <StatusChip tone={delivery.state === "failed" ? "danger" : "warning"}>
                    {stateLabel(delivery.state)}
                  </StatusChip>
                  <span className="text-muted-foreground">
                    to {delivery.recipientName ?? "a member"} · {delivery.attempts} attempt(s)
                  </span>
                </span>
                <span className="text-muted-foreground">
                  {deliveryErrorLabel(delivery.lastErrorCode)}
                  {delivery.state === "retry"
                    ? ` · next attempt ${dateTime.format(new Date(delivery.nextAttemptAt))}`
                    : ""}
                  {delivery.shiftId ? (
                    <>
                      {" · "}
                      <Link
                        href={shiftLink(delivery.shiftId)}
                        className="text-primary underline underline-offset-4"
                      >
                        View shift
                      </Link>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
