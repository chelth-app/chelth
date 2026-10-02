import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Panel } from "@/components/ui/panel";

import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { InlineActionForm } from "@/components/forms/inline-action-form";
import { ActivityTimeline } from "@/components/ui/activity-timeline";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import {
  assignableRoles,
  AssignRoleForm,
  getMyCapabilities,
  getOrganisation,
  InviteMemberForm,
  listAuditEvents,
  listInvites,
  listMembers,
  listRoles,
  organisationIdSchema,
  ResendInviteForm,
  revokeInviteAction,
  revokeRoleAction,
  setMembershipStatusAction,
} from "@/features/organisations";
import { RelationshipStatusBadge, listPartnerRelationships } from "@/features/facilities";
import { listSharedWorkerCompliance, ReadinessBadge } from "@/features/compliance";
import { isWorkspaceStaff, OrganisationSections, StepUpNotice } from "@/features/organisations";
import { COMPLIANCE_REASON_LABELS } from "@/lib/domain/credentials";
import { getMyWorkerRecord, WorkerStatusBadge } from "@/features/workforce";
import { requireAuthIdentity } from "@/lib/auth/session";
import { auditActionLabel, CAPABILITIES, capabilityState, type CapabilityGrant } from "@/lib/authz";

import { AgencyOperationsOverview } from "./_components/agency-operations-overview";
import { FacilityOperationsOverview } from "./_components/facility-operations-overview";

export const metadata: Metadata = { title: "Overview" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default async function OrganisationPage({
  params,
}: PageProps<"/app/organisations/[organisationId]">) {
  const { organisationId: rawId } = await params;
  const parsedId = organisationIdSchema.safeParse(rawId);
  if (!parsedId.success) notFound();
  const organisationId = parsedId.data;

  const [identity, organisation] = await Promise.all([
    requireAuthIdentity(),
    getOrganisation(organisationId),
  ]);
  // RLS returns nothing for non-members: indistinguishable from "does not exist".
  if (!organisation) notFound();

  const grants: CapabilityGrant[] = await getMyCapabilities(organisationId);
  const can = (capability: Parameters<typeof capabilityState>[1]) =>
    capabilityState(grants, capability);
  const needsStepUp = grants.some((grant) => !grant.isSatisfied);
  const workspaceStaff = isWorkspaceStaff(grants.map((grant) => grant.capabilityKey));

  const [roles, members, invites, audit] = await Promise.all([
    listRoles(organisation.type),
    can(CAPABILITIES.MEMBERSHIP_VIEW) === "granted"
      ? listMembers(organisationId)
      : Promise.resolve([]),
    can(CAPABILITIES.MEMBERSHIP_INVITE) === "granted"
      ? listInvites(organisationId)
      : Promise.resolve([]),
    can(CAPABILITIES.AUDIT_VIEW) === "granted"
      ? listAuditEvents(organisationId)
      : Promise.resolve([]),
  ]);
  const roleName = new Map(roles.map((role) => [role.key, role.name]));
  const grantableRoles = assignableRoles(roles, grants).map(({ key, name }) => ({ key, name }));
  const memberName = new Map(
    members.map((member) => [member.profileId, member.displayName ?? "Member"]),
  );
  const me = members.find((member) => member.profileId === identity.userId);
  const [myWorkerRecord, partnerRelationships] = await Promise.all([
    organisation.type === "agency" ? getMyWorkerRecord(organisationId) : Promise.resolve(null),
    organisation.type === "facility" && can(CAPABILITIES.RELATIONSHIP_VIEW) === "granted"
      ? listPartnerRelationships(organisationId)
      : Promise.resolve([]),
  ]);
  // Facility side: the narrow, audited compliance projection per active relationship.
  const sharedCompliance =
    organisation.type === "facility" && can(CAPABILITIES.CREDENTIAL_VIEW) === "granted"
      ? await Promise.all(
          partnerRelationships
            .filter((relationship) => relationship.status === "active")
            .map(async (relationship) => ({
              relationship,
              workers: await listSharedWorkerCompliance(relationship.relationshipId),
            })),
        )
      : [];

  return (
    <>
      <PageHeader
        title={organisation.name}
        description={
          workspaceStaff ? (
            <p>
              {organisation.type === "agency"
                ? "What needs attention, what is happening today and what is coming up."
                : "Your staffing requests, who is expected and the timesheets waiting for sign-off."}
            </p>
          ) : undefined
        }
        back={
          <Link href="/app" className="text-primary underline underline-offset-4">
            All organisations
          </Link>
        }
        meta={
          <>
            <Badge tone="brand">{organisation.type === "agency" ? "Agency" : "Facility"}</Badge>
            {organisation.status !== "active" ? (
              <StatusChip tone="warning">Organisation suspended</StatusChip>
            ) : null}
            {me?.roleKeys.map((key) => (
              <Badge key={key} tone="info">
                {roleName.get(key) ?? key}
              </Badge>
            ))}
          </>
        }
      />

      {needsStepUp ? <StepUpNotice returnTo={`/app/organisations/${organisationId}`} /> : null}

      {organisation.type === "agency" && workspaceStaff ? (
        <AgencyOperationsOverview organisationId={organisationId} can={can} />
      ) : null}
      {organisation.type === "facility" && workspaceStaff ? (
        <FacilityOperationsOverview organisationId={organisationId} can={can} />
      ) : null}

      {/*
        Workspace staff navigate with the sidebar (P0-E8-S1), so the section
        link grid is not repeated here. Self-service links (My shifts, My
        credentials) are not in the sidebar and stay. Self-service-only members
        are on the personal frame and keep every link they can use.
      */}
      <OrganisationSections
        organisationId={organisationId}
        selfServiceOnly={workspaceStaff}
        showWorkforce={can(CAPABILITIES.WORKER_VIEW) !== "not_held"}
        showFacilities={can(CAPABILITIES.FACILITY_VIEW) !== "not_held"}
        showCompliance={can(CAPABILITIES.CREDENTIAL_REQUIREMENTS_VIEW) !== "not_held"}
        showMyCredentials={myWorkerRecord !== null && myWorkerRecord.status !== "terminated"}
        showShifts={organisation.type === "agency" && can(CAPABILITIES.SHIFT_VIEW) !== "not_held"}
        showMyShifts={myWorkerRecord !== null}
        showAttendance={
          organisation.type === "agency" && can(CAPABILITIES.ATTENDANCE_VIEW) !== "not_held"
        }
        showTimesheets={
          (organisation.type === "agency" &&
            (can(CAPABILITIES.TIMESHEET_VIEW) !== "not_held" || myWorkerRecord !== null)) ||
          (organisation.type === "facility" &&
            can(CAPABILITIES.TIMESHEET_FACILITY_SIGNOFF) !== "not_held")
        }
        showRates={organisation.type === "agency" && can(CAPABILITIES.RATES_VIEW) !== "not_held"}
        showPricing={
          organisation.type === "agency" && can(CAPABILITIES.PRICING_VIEW) !== "not_held"
        }
        showPayroll={
          organisation.type === "agency" && can(CAPABILITIES.PAYROLL_VIEW) !== "not_held"
        }
        showInvoices={
          organisation.type === "agency" && can(CAPABILITIES.INVOICE_VIEW) !== "not_held"
        }
        showOperations={
          organisation.type === "agency" && can(CAPABILITIES.ASSIGNMENT_VIEW) !== "not_held"
        }
        showStaffingRequests={
          organisation.type === "facility" && can(CAPABILITIES.SHIFT_VIEW) !== "not_held"
        }
      />

      {myWorkerRecord ? (
        <Panel titleId="my-worker-heading" title={<>My worker record</>}>
          <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-md bg-surface-muted p-4 text-sm">
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <WorkerStatusBadge status={myWorkerRecord.status} />
            </dd>
            <dt className="text-muted-foreground">Start date</dt>
            <dd>{myWorkerRecord.startDate ?? "Not started"}</dd>
          </dl>
        </Panel>
      ) : null}

      {partnerRelationships.length > 0 ? (
        <Panel titleId="partners-heading" title={<>Agency relationships</>}>
          <ul className="flex flex-col divide-y divide-border border-y border-border text-sm">
            {partnerRelationships.map((relationship) => (
              <li
                key={relationship.relationshipId}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <span className="font-medium">{relationship.agencyName}</span>
                <RelationshipStatusBadge status={relationship.status} />
              </li>
            ))}
          </ul>
          {sharedCompliance.map(({ relationship, workers }) => (
            <div key={relationship.relationshipId} className="flex flex-col gap-2">
              <h3 className="font-medium">Workers shared by {relationship.agencyName}</h3>
              {workers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No workers shared yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border border-y border-border text-sm">
                  {workers.map((sharedWorker) => (
                    <li key={sharedWorker.workerId} className="flex flex-col gap-2 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{sharedWorker.workerName ?? "Worker"}</span>
                        <ReadinessBadge status={sharedWorker.readiness} />
                      </div>
                      <ul className="flex flex-col gap-1 text-muted-foreground">
                        {sharedWorker.items.map((item, index) => (
                          <li key={`${item.credentialTypeName}-${index}`}>
                            {item.credentialTypeName}: {COMPLIANCE_REASON_LABELS[item.reason]}
                            {item.effectiveExpiryDate
                              ? ` (valid to ${item.effectiveExpiryDate})`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </Panel>
      ) : null}

      {can(CAPABILITIES.MEMBERSHIP_VIEW) === "granted" ? (
        <Panel titleId="members-heading" title={<>Members</>}>
          {/* Focusable, labelled scroll region: keyboard users can scroll the table on small screens. */}
          <DataTableRegion aria-label="Members table">
            <DataTable className="min-w-[40rem]">
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Name</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Roles</DataTableHeaderCell>
                  <DataTableHeaderCell>Manage</DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                {members.map((member) => {
                  const name = member.displayName ?? "Member";
                  const isSelf = member.profileId === identity.userId;
                  return (
                    <DataTableRow key={member.membershipId}>
                      <th scope="row" className="px-3 py-2.5 font-medium">
                        {name}
                        {isSelf ? <span className="text-muted-foreground"> (you)</span> : null}
                      </th>
                      <DataTableCell>
                        <StatusChip
                          tone={
                            member.status === "active"
                              ? "success"
                              : member.status === "suspended"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {member.status === "active"
                            ? "Active"
                            : member.status === "suspended"
                              ? "Suspended"
                              : "Revoked"}
                        </StatusChip>
                      </DataTableCell>
                      <DataTableCell>
                        <ul className="flex flex-col gap-2">
                          {member.roleKeys.map((key) => (
                            <li key={key} className="flex flex-wrap items-center gap-2">
                              <Badge tone="info">{roleName.get(key) ?? key}</Badge>
                              {!isSelf && can(CAPABILITIES.ROLE_ASSIGN) === "granted" ? (
                                <InlineActionForm
                                  action={revokeRoleAction}
                                  fields={{
                                    organisationId,
                                    membershipId: member.membershipId,
                                    roleKey: key,
                                  }}
                                  label="Remove"
                                  accessibleLabel={`Remove ${roleName.get(key) ?? key} role from ${name}`}
                                  variant="ghost"
                                />
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </DataTableCell>
                      <DataTableCell className="flex flex-col gap-2">
                        {isSelf ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            {can(CAPABILITIES.ROLE_ASSIGN) === "granted" &&
                            member.status === "active" ? (
                              <AssignRoleForm
                                organisationId={organisationId}
                                membershipId={member.membershipId}
                                memberName={name}
                                roles={grantableRoles.filter(
                                  (role) => !member.roleKeys.includes(role.key),
                                )}
                              />
                            ) : null}
                            {can(CAPABILITIES.MEMBERSHIP_MANAGE) === "granted" &&
                            member.status !== "revoked" ? (
                              <div className="flex flex-wrap gap-2">
                                <InlineActionForm
                                  action={setMembershipStatusAction}
                                  fields={{
                                    organisationId,
                                    membershipId: member.membershipId,
                                    status: member.status === "active" ? "suspended" : "active",
                                  }}
                                  label={member.status === "active" ? "Suspend" : "Reinstate"}
                                  accessibleLabel={`${member.status === "active" ? "Suspend" : "Reinstate"} ${name}`}
                                />
                                <InlineActionForm
                                  action={setMembershipStatusAction}
                                  fields={{
                                    organisationId,
                                    membershipId: member.membershipId,
                                    status: "revoked",
                                  }}
                                  label="Remove from organisation"
                                  accessibleLabel={`Remove ${name} from organisation`}
                                  variant="danger"
                                />
                              </div>
                            ) : null}
                          </>
                        )}
                      </DataTableCell>
                    </DataTableRow>
                  );
                })}
              </tbody>
            </DataTable>
          </DataTableRegion>
        </Panel>
      ) : null}

      {can(CAPABILITIES.MEMBERSHIP_INVITE) === "granted" ? (
        <Panel titleId="invites-heading" title={<>Invitations</>}>
          <InviteMemberForm organisationId={organisationId} roles={grantableRoles} />
          {invites.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border border-y border-border">
              {invites.map((invite) => (
                <li
                  key={invite.id}
                  className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm"
                >
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">{invite.email}</span>
                    <span className="text-muted-foreground">
                      {roleName.get(invite.roleKey) ?? invite.roleKey} ·{" "}
                      {invite.status === "pending"
                        ? `expires ${dateTime.format(new Date(invite.expiresAt))}`
                        : invite.status}
                    </span>
                  </div>
                  {invite.status === "pending" ? (
                    <div className="flex flex-wrap gap-2">
                      <ResendInviteForm
                        organisationId={organisationId}
                        inviteId={invite.id}
                        email={invite.email}
                      />
                      <InlineActionForm
                        action={revokeInviteAction}
                        fields={{ organisationId, inviteId: invite.id }}
                        label="Revoke"
                        accessibleLabel={`Revoke invitation to ${invite.email}`}
                        variant="ghost"
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      ) : null}

      {can(CAPABILITIES.AUDIT_VIEW) === "granted" ? (
        <Panel titleId="audit-heading" title={<>Recent activity</>}>
          {audit.length === 0 ? (
            <EmptyState
              headingLevel={3}
              title="No activity yet"
              description="Membership, role and invitation changes will appear here."
            />
          ) : (
            <div>
              <ActivityTimeline
                label="Recent activity"
                items={audit.map((event) => ({
                  id: event.id,
                  title: auditActionLabel(event.action),
                  meta: (
                    <>
                      by{" "}
                      {event.actorProfileId
                        ? (memberName.get(event.actorProfileId) ?? "a former member")
                        : "the platform"}{" "}
                      ·{" "}
                      <time dateTime={event.occurredAt}>
                        {dateTime.format(new Date(event.occurredAt))}
                      </time>
                    </>
                  ),
                }))}
              />
            </div>
          )}
        </Panel>
      ) : null}
    </>
  );
}
