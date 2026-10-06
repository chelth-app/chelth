import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { RefChip } from "@/components/reference/locked-reference";
import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import {
  assignableRoles,
  AssignRoleForm,
  getMyCapabilities,
  InviteMemberForm,
  listInvites,
  listMembers,
  listRoles,
  loadOrganisationPage,
  ResendInviteForm,
  revokeInviteAction,
  revokeRoleAction,
  setMembershipStatusAction,
  StepUpNotice,
  stepUpHref,
} from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";

import { canOpenSection, settingsHref } from "../_components/settings-sections";
import {
  SettingsActionLink,
  SettingsExplanationList,
  SettingsExplanationRow,
} from "../_components/settings-ui";

export const metadata: Metadata = { title: "Team & Permissions" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

/**
 * Settings → Team & Permissions. The same member, role and invitation
 * administration that lived on the Overview (moved here, P0-E8-S9H), with the
 * same capability gates and forms. The database enforces the role ceiling,
 * the last-admin rule and step-up for privileged changes.
 *
 * AAL1 with a privileged capability held (`step_up_required`): the controls
 * stay absent and the existing step-up route is offered in their place —
 * "Verify to manage" on other members' rows, and a verification-required
 * Invitations card with no invitation data. Without the capability, nothing
 * is offered. UI hint only: every RPC re-checks (CH402 / CH403).
 */
export default async function SettingsTeamPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/settings/team">) {
  const context = await loadOrganisationPage((await params).organisationId);
  const { organisationId, organisation, can, userId, needsStepUp } = context;
  if (!canOpenSection("team", organisation.type, can)) notFound();

  const canViewMembers = can(CAPABILITIES.MEMBERSHIP_VIEW) === "granted";
  const canInvite = can(CAPABILITIES.MEMBERSHIP_INVITE) === "granted";
  const canAssign = can(CAPABILITIES.ROLE_ASSIGN) === "granted";
  const canManage = can(CAPABILITIES.MEMBERSHIP_MANAGE) === "granted";
  // Held but waiting for authenticator verification (never true without the capability).
  const verifyToManage =
    !canAssign &&
    !canManage &&
    (can(CAPABILITIES.ROLE_ASSIGN) === "step_up_required" ||
      can(CAPABILITIES.MEMBERSHIP_MANAGE) === "step_up_required");
  const verifyToInvite = can(CAPABILITIES.MEMBERSHIP_INVITE) === "step_up_required";
  const verifyHref = stepUpHref(settingsHref(organisationId, "team"));

  const [grants, roles, members, invites] = await Promise.all([
    getMyCapabilities(organisationId),
    listRoles(organisation.type),
    canViewMembers ? listMembers(organisationId) : Promise.resolve([]),
    canInvite ? listInvites(organisationId) : Promise.resolve([]),
  ]);
  const roleName = new Map(roles.map((role) => [role.key, role.name]));
  const grantableRoles = assignableRoles(roles, grants).map(({ key, name }) => ({ key, name }));
  const activeMembers = members.filter((member) => member.status === "active").length;
  const pendingInvites = invites.filter((invite) => invite.status === "pending").length;

  return (
    <>
      {needsStepUp ? <StepUpNotice returnTo={settingsHref(organisationId, "team")} /> : null}

      {canViewMembers ? (
        <Panel
          titleId="members-heading"
          title={<>Members</>}
          description={<>People with access to {organisation.name} and the roles they hold.</>}
          action={
            <RefChip tone="success" className="font-semibold">
              {activeMembers} active
            </RefChip>
          }
        >
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
                  const isSelf = member.profileId === userId;
                  return (
                    <DataTableRow key={member.membershipId}>
                      <th scope="row" className="px-3 py-2.5 font-medium text-chelth-navy">
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
                              <RefChip tone="info" className="font-normal">
                                {roleName.get(key) ?? key}
                              </RefChip>
                              {!isSelf && canAssign ? (
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
                            {canAssign && member.status === "active" ? (
                              <AssignRoleForm
                                organisationId={organisationId}
                                membershipId={member.membershipId}
                                memberName={name}
                                roles={grantableRoles.filter(
                                  (role) => !member.roleKeys.includes(role.key),
                                )}
                              />
                            ) : null}
                            {canManage && member.status !== "revoked" ? (
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
                            {verifyToManage ? (
                              <SettingsActionLink href={verifyHref} icon="compliance" size="sm">
                                Verify to manage<span className="sr-only"> {name}</span>
                              </SettingsActionLink>
                            ) : !canAssign && !canManage ? (
                              <span className="text-muted-foreground">—</span>
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

      {canInvite ? (
        <Panel
          titleId="invites-heading"
          title={<>Invitations</>}
          description={
            <>
              Invite a person by email with one role. You can only offer roles within your own
              permissions.
            </>
          }
          action={
            pendingInvites > 0 ? (
              <RefChip tone="info" className="font-semibold">
                {pendingInvites} pending
              </RefChip>
            ) : undefined
          }
        >
          <InviteMemberForm organisationId={organisationId} roles={grantableRoles} />
          {invites.length > 0 ? (
            <ul
              aria-label="Invitations"
              className="flex flex-col divide-y divide-[rgba(18,107,103,0.12)] border-y border-[rgba(18,107,103,0.12)]"
            >
              {invites.map((invite) => (
                <li
                  key={invite.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-1 py-3 text-sm"
                >
                  <div className="flex flex-col gap-1">
                    <span className="font-medium text-chelth-navy">{invite.email}</span>
                    <span className="text-slate-600">
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
          ) : (
            <p className="text-[13.5px] text-slate-600">No invitations yet.</p>
          )}
        </Panel>
      ) : null}

      {verifyToInvite ? (
        <Panel
          titleId="invites-heading"
          title={<>Invitations</>}
          description={<>Invite people by email and manage pending invitations.</>}
          action={
            <RefChip tone="warning" className="font-semibold">
              Verification required
            </RefChip>
          }
        >
          <SettingsExplanationList label="Invitation access">
            <SettingsExplanationRow
              icon="compliance"
              title="Authenticator verification required"
              note="Inviting people and managing invitations requires verification with your authenticator app."
              trailing={
                <SettingsActionLink href={verifyHref} icon="compliance">
                  Verify to manage invitations
                </SettingsActionLink>
              }
            />
          </SettingsExplanationList>
        </Panel>
      ) : null}

      <Panel
        titleId="role-permissions-heading"
        title={<>Role Permissions</>}
        description={
          <>
            Roles are defined by Chelth for{" "}
            {organisation.type === "agency" ? "agencies" : "facilities"} and cannot be edited here.
            Privileged permissions also require verification with an authenticator app.
          </>
        }
      >
        <ul
          aria-label="Roles"
          className="flex flex-col divide-y divide-[rgba(18,107,103,0.12)] border-y border-[rgba(18,107,103,0.12)]"
        >
          {roles.map((role) => (
            <li
              key={role.key}
              className="flex flex-wrap items-center justify-between gap-3 px-1 py-3 text-sm"
            >
              <span className="font-semibold text-chelth-navy">{role.name}</span>
              <span className="text-slate-600">
                {role.capabilityKeys.length}{" "}
                {role.capabilityKeys.length === 1 ? "permission" : "permissions"}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
