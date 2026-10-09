import { RefChip, RefPanel } from "@/components/reference/locked-reference";
import {
  RECORD_ROW,
  RECORD_ROW_META,
  RECORD_ROW_TITLE,
  RecordList,
} from "@/components/reference/record-page";
import type { StatusTone } from "@/components/ui/status-chip";
import {
  CancelInviteForm,
  InviteNoticeProvider,
  type OrganisationInvite,
  ResendInviteForm,
} from "@/features/organisations";

import { LockedEmpty } from "../../(finance)/_components/finance-locked";

const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

/** Expiry is computed from the invitation's own date (status stays `pending`). */
function isExpired(expiresAt: string): boolean {
  return Date.parse(expiresAt) <= Date.now();
}

const DELIVERY: Record<OrganisationInvite["deliveryStatus"], { label: string; tone: StatusTone }> =
  {
    sent: { label: "Emailed", tone: "success" },
    skipped: { label: "Not emailed", tone: "neutral" },
    failed: { label: "Email failed", tone: "danger" },
    not_attempted: { label: "Not sent yet", tone: "neutral" },
  };

/**
 * Workforce → Pending Invitations (P0-E9-3A). Healthcare Worker invitations
 * that have not been accepted yet — they are NOT workers and never appear in
 * the worker table. Real invitation data only (list_organisation_invites,
 * membership.invite at AAL2): expiry is computed from the invitation's own
 * date; delivery status is the recorded post-commit outcome. Accepted and
 * cancelled invitations leave this list.
 */
export function PendingInvitations({
  organisationId,
  invites,
}: {
  organisationId: string;
  invites: OrganisationInvite[];
}) {
  return (
    <RefPanel
      title="Pending Invitations"
      titleId="pending-invitations-heading"
      action={
        <span className="text-[13.5px] text-muted-foreground">
          {invites.length === 1 ? "1 pending invitation" : `${invites.length} pending invitations`}
        </span>
      }
    >
      <InviteNoticeProvider>
        {invites.length === 0 ? (
          <LockedEmpty
            icon="workforce"
            title="No pending invitations."
            note="Invited healthcare workers appear here until they accept."
          />
        ) : (
          <div className="mt-[9px] px-[5px]">
            <RecordList label="Pending worker invitations">
              {invites.map((invite) => {
                const expired = isExpired(invite.expiresAt);
                const delivery = DELIVERY[invite.deliveryStatus];
                return (
                  <li key={invite.id} className={`${RECORD_ROW} justify-between`}>
                    <span className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
                      <span className={`${RECORD_ROW_TITLE} break-all`}>{invite.email}</span>
                      <span className={RECORD_ROW_META}>
                        Healthcare Worker · Invited {date.format(new Date(invite.invitedAt))} ·{" "}
                        {expired ? "Expired" : "Expires"} {date.format(new Date(invite.expiresAt))}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-1.5">
                        <RefChip tone={expired ? "warning" : "info"} className="font-semibold">
                          {expired ? "Expired" : "Pending"}
                        </RefChip>
                        <RefChip tone={delivery.tone} className="font-semibold">
                          {delivery.label}
                        </RefChip>
                      </span>
                    </span>
                    <span className="flex flex-wrap items-start gap-2">
                      <ResendInviteForm
                        organisationId={organisationId}
                        inviteId={invite.id}
                        email={invite.email}
                      />
                      <CancelInviteForm
                        organisationId={organisationId}
                        inviteId={invite.id}
                        email={invite.email}
                      />
                    </span>
                  </li>
                );
              })}
            </RecordList>
          </div>
        )}
      </InviteNoticeProvider>
    </RefPanel>
  );
}
