import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { Badge } from "@/components/ui/badge";
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
import { OrganisationSections, StepUpNotice } from "@/features/organisations";
import { COMPLIANCE_REASON_LABELS } from "@/lib/domain/credentials";
import { getMyWorkerRecord, WorkerStatusBadge } from "@/features/workforce";
import { requireAuthIdentity } from "@/lib/auth/session";
import { auditActionLabel, CAPABILITIES, capabilityState, type CapabilityGrant } from "@/lib/authz";

export const metadata: Metadata = { title: "Organisation" };

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
      <header className="flex flex-col gap-2">
        <Link href="/app" className="w-fit text-sm text-primary underline underline-offset-4">
          All organisations
        </Link>
        <h1 className="text-2xl font-semibold">{organisation.name}</h1>
        <div className="flex flex-wrap gap-2">
          <Badge tone="brand">{organisation.type === "agency" ? "Agency" : "Facility"}</Badge>
          {organisation.status !== "active" ? (
            <Badge tone="warning">Organisation suspended</Badge>
          ) : null}
          {me?.roleKeys.map((key) => (
            <Badge key={key} tone="info">
              {roleName.get(key) ?? key}
            </Badge>
          ))}
        </div>
      </header>

      {needsStepUp ? <StepUpNotice returnTo={`/app/organisations/${organisationId}`} /> : null}

      <OrganisationSections
        organisationId={organisationId}
        showWorkforce={can(CAPABILITIES.WORKER_VIEW) !== "not_held"}
        showFacilities={can(CAPABILITIES.FACILITY_VIEW) !== "not_held"}
        showCompliance={can(CAPABILITIES.CREDENTIAL_REQUIREMENTS_VIEW) !== "not_held"}
        showMyCredentials={myWorkerRecord !== null && myWorkerRecord.status !== "terminated"}
        showShifts={organisation.type === "agency" && can(CAPABILITIES.SHIFT_VIEW) !== "not_held"}
        showMyShifts={myWorkerRecord !== null}
        showAttendance={
          organisation.type === "agency" && can(CAPABILITIES.ATTENDANCE_VIEW) !== "not_held"
        }
        showOperations={
          organisation.type === "agency" && can(CAPABILITIES.ASSIGNMENT_VIEW) !== "not_held"
        }
        showStaffingRequests={
          organisation.type === "facility" && can(CAPABILITIES.SHIFT_VIEW) !== "not_held"
        }
      />

      {myWorkerRecord ? (
        <section aria-labelledby="my-worker-heading" className="flex flex-col gap-3">
          <h2 id="my-worker-heading" className="text-lg font-semibold">
            My worker record
          </h2>
          <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <WorkerStatusBadge status={myWorkerRecord.status} />
            </dd>
            <dt className="text-muted-foreground">Start date</dt>
            <dd>{myWorkerRecord.startDate ?? "Not started"}</dd>
          </dl>
        </section>
      ) : null}

      {partnerRelationships.length > 0 ? (
        <section aria-labelledby="partners-heading" className="flex flex-col gap-3">
          <h2 id="partners-heading" className="text-lg font-semibold">
            Agency relationships
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface text-sm">
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
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface text-sm">
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
        </section>
      ) : null}

      {can(CAPABILITIES.MEMBERSHIP_VIEW) === "granted" ? (
        <section aria-labelledby="members-heading" className="flex flex-col gap-3">
          <h2 id="members-heading" className="text-lg font-semibold">
            Members
          </h2>
          {/* Focusable, labelled scroll region: keyboard users can scroll the table on small screens. */}
          <div
            role="region"
            aria-labelledby="members-heading"
            tabIndex={0}
            className="overflow-x-auto rounded-lg border border-border bg-surface"
          >
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-border bg-surface-muted">
                <tr>
                  <th scope="col" className="p-3 font-medium">
                    Name
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    Roles
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    Manage
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const name = member.displayName ?? "Member";
                  const isSelf = member.profileId === identity.userId;
                  return (
                    <tr
                      key={member.membershipId}
                      className="border-b border-border align-top last:border-0"
                    >
                      <th scope="row" className="p-3 font-medium">
                        {name}
                        {isSelf ? <span className="text-muted-foreground"> (you)</span> : null}
                      </th>
                      <td className="p-3">
                        <Badge
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
                        </Badge>
                      </td>
                      <td className="p-3">
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
                      </td>
                      <td className="flex flex-col gap-2 p-3">
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {can(CAPABILITIES.MEMBERSHIP_INVITE) === "granted" ? (
        <section aria-labelledby="invites-heading" className="flex flex-col gap-3">
          <h2 id="invites-heading" className="text-lg font-semibold">
            Invitations
          </h2>
          <InviteMemberForm organisationId={organisationId} roles={grantableRoles} />
          {invites.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
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
        </section>
      ) : null}

      {can(CAPABILITIES.AUDIT_VIEW) === "granted" ? (
        <section aria-labelledby="audit-heading" className="flex flex-col gap-3">
          <h2 id="audit-heading" className="text-lg font-semibold">
            Recent activity
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface text-sm">
            {audit.map((event) => (
              <li key={event.id} className="flex flex-wrap justify-between gap-2 p-3">
                <span>
                  {auditActionLabel(event.action)}
                  <span className="text-muted-foreground">
                    {" "}
                    by{" "}
                    {event.actorProfileId
                      ? (memberName.get(event.actorProfileId) ?? "a former member")
                      : "the platform"}
                  </span>
                </span>
                <time dateTime={event.occurredAt} className="text-muted-foreground">
                  {dateTime.format(new Date(event.occurredAt))}
                </time>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
