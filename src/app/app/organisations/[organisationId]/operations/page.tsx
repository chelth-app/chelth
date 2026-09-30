import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
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
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          {organisation.name}
        </Link>
        <h1 className="text-2xl font-semibold">Operations</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Upcoming work that needs a decision. Chelth re-checks upcoming assignments every hour.
        </p>
      </header>

      {canSeeIssues ? (
        <section aria-labelledby="attention-heading" className="flex flex-col gap-3">
          <h2 id="attention-heading" className="text-lg font-semibold">
            Assignments needing attention
          </h2>
          {issues.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing needs attention.</p>
          ) : (
            <ul aria-label="Assignments needing attention" className="flex flex-col gap-3">
              {issues.map((issue) => (
                <li
                  key={issue.id}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={shiftLink(issue.shiftId)}
                      className="font-medium text-primary underline underline-offset-4"
                    >
                      {issue.workerName ?? "Worker"} · {issue.facilityName} ·{" "}
                      {formatShiftDate(issue)}
                    </Link>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={issue.severity === "urgent" ? "danger" : "warning"}>
                        {ASSIGNMENT_ISSUE_SEVERITY_LABELS[issue.severity]}
                      </Badge>
                      <Badge tone="neutral">
                        {ASSIGNMENT_STATUS_LABELS[issue.assignmentStatus]}
                      </Badge>
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
        </section>
      ) : null}

      <section aria-labelledby="affected-heading" className="flex flex-col gap-3">
        <h2 id="affected-heading" className="text-lg font-semibold">
          Upcoming work under inactive relationships
        </h2>
        {affected.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul aria-label="Affected upcoming shifts" className="flex flex-col gap-2">
            {affected.map((shift) => (
              <li
                key={shift.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
              >
                <Link
                  href={shiftLink(shift.id)}
                  className="text-primary underline underline-offset-4"
                >
                  {shift.facilityName} · {formatShiftDate(shift)} · {formatShiftTimeRange(shift)}
                </Link>
                <span className="flex flex-wrap gap-2">
                  <ShiftStatusBadge status={shift.status} />
                  <Badge tone="warning">
                    Relationship{" "}
                    {RELATIONSHIP_STATUS_LABELS[shift.relationshipStatus].toLowerCase()}
                  </Badge>
                  <Badge tone="neutral">{shift.activeCount} assigned</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="delivery-heading" className="flex flex-col gap-3">
        <h2 id="delivery-heading" className="text-lg font-semibold">
          Notifications not delivered
        </h2>
        <p className="text-sm text-muted-foreground">
          Emails to members of {organisation.name} that are retrying or failed.
        </p>
        {deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">All notifications delivered.</p>
        ) : (
          <ul aria-label="Undelivered notifications" className="flex flex-col gap-2">
            {deliveries.map((delivery) => (
              <li
                key={delivery.id}
                className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {isNotificationEvent(delivery.event)
                      ? NOTIFICATION_EVENT_LABELS[delivery.event]
                      : delivery.event}
                  </span>
                  <Badge tone={delivery.state === "failed" ? "danger" : "warning"}>
                    {stateLabel(delivery.state)}
                  </Badge>
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
      </section>
    </>
  );
}
