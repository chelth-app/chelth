import type { Metadata } from "next";

import { ActivityTimeline } from "@/components/ui/activity-timeline";
import { KeyValueList } from "@/components/ui/key-value-list";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { getMyProfile, listMfaFactors } from "@/features/identity";
import {
  listAuditEvents,
  listMembers,
  loadOrganisationPage,
  StepUpNotice,
} from "@/features/organisations";
import { getAssurance } from "@/lib/auth/session";
import { resolveDisplayTimeZone } from "@/lib/domain/display-timezone";
import { auditActionLabel, CAPABILITIES } from "@/lib/authz";

import { settingsHref } from "../_components/settings-sections";
import { SettingsActionLink, SettingsActionRow } from "../_components/settings-ui";

export const metadata: Metadata = { title: "Security" };

/**
 * Settings → Security. Real security state only: this session's assurance
 * level and whether the caller has an authenticator (managed on the personal
 * Security page — an account setting, not an organisation one), the fixed
 * privileged-action rule, and the organisation's audit log (moved from the
 * Overview, P0-E8-S9H). Chelth has no MFA-policy, session-timeout or
 * session-revocation settings, so none are shown.
 */
export default async function SettingsSecurityPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/settings/security">) {
  // Audit times are personal display (P0-E9-3F): the person's own timezone.
  const displayTimeZone = resolveDisplayTimeZone(await getMyProfile());
  const dateTime = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: displayTimeZone,
  });
  const context = await loadOrganisationPage((await params).organisationId);
  const { organisationId, can, needsStepUp } = context;
  const canAudit = can(CAPABILITIES.AUDIT_VIEW) === "granted";
  const [factors, assurance, audit, members] = await Promise.all([
    listMfaFactors(),
    getAssurance(),
    canAudit ? listAuditEvents(organisationId) : Promise.resolve([]),
    canAudit && can(CAPABILITIES.MEMBERSHIP_VIEW) === "granted"
      ? listMembers(organisationId)
      : Promise.resolve([]),
  ]);
  const memberName = new Map(
    members.map((member) => [member.profileId, member.displayName ?? "Member"]),
  );
  const returnTo = settingsHref(organisationId, "security");

  return (
    <>
      {needsStepUp ? <StepUpNotice returnTo={returnTo} /> : null}

      <Panel
        titleId="account-security-heading"
        title={<>Your Account Security</>}
        description={
          <>
            Authenticator apps belong to your Chelth account, not to this workspace. Administration
            and other privileged actions always require verification with an authenticator app.
          </>
        }
      >
        <KeyValueList
          className="max-w-3xl"
          items={[
            {
              label: "Authenticator app",
              value:
                factors.length > 0 ? (
                  <StatusChip tone="success">Set up</StatusChip>
                ) : (
                  <StatusChip tone="warning">Not set up</StatusChip>
                ),
            },
            {
              label: "This session",
              value:
                assurance.current === "aal2" ? (
                  <StatusChip tone="success">Verified with authenticator</StatusChip>
                ) : (
                  <StatusChip tone="neutral">Password only</StatusChip>
                ),
            },
          ]}
        />
        <SettingsActionRow>
          <SettingsActionLink
            href={`/app/security?next=${encodeURIComponent(returnTo)}`}
            icon="settings"
          >
            {factors.length > 0 ? "Manage account security" : "Set up an authenticator app"}
          </SettingsActionLink>
          <SettingsActionLink href="/app/account">Account details</SettingsActionLink>
        </SettingsActionRow>
      </Panel>

      {canAudit ? (
        <Panel
          titleId="audit-heading"
          title={<>Audit Log</>}
          description={
            <>
              Recent membership, role, invitation and other administrative changes in this
              workspace. The log is append-only. Times are shown in {displayTimeZone}.
            </>
          }
        >
          {audit.length === 0 ? (
            <p className="text-[13.5px] text-slate-600">No activity yet.</p>
          ) : (
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
          )}
        </Panel>
      ) : null}
    </>
  );
}
