/** What the issuer sees after an invitation is issued or re-issued. */
export type IssuedInviteView = {
  email: string;
  expiresAt: string;
  delivery: "sent" | "skipped" | "failed";
  inviteUrl: string | null;
  /** An existing pending invitation was re-issued (new link; the old one no longer works). */
  reissued?: boolean;
};

const NOT_SENT_REASON: Record<Exclude<IssuedInviteView["delivery"], "sent">, string> = {
  skipped: "Email delivery is not configured yet",
  failed: "The invitation email could not be sent",
};

/**
 * Outcome of issuing an invitation. When the email was sent the link is not
 * shown at all; otherwise the issuer sees it exactly once to share it through
 * a trusted channel.
 */
export function IssuedInviteLink({ invite }: { invite: IssuedInviteView }) {
  if (invite.delivery === "sent" || !invite.inviteUrl) {
    return (
      <p
        role="status"
        className="rounded-md bg-success-soft p-3 text-sm text-success-soft-foreground"
      >
        {invite.reissued ? "Invitation resent to" : "Invitation emailed to"}{" "}
        <strong>{invite.email}</strong>.
        {invite.reissued ? " The previous invitation link no longer works." : null}
      </p>
    );
  }
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-md bg-success-soft p-3 text-sm text-success-soft-foreground"
    >
      <p>
        {invite.reissued ? "Invitation re-issued for" : "Invitation ready for"}{" "}
        <strong>{invite.email}</strong>.{" "}
        {invite.reissued ? "The previous invitation link no longer works. " : null}
        {NOT_SENT_REASON[invite.delivery]}, so share this link with them. It is shown only once and
        expires on {new Date(invite.expiresAt).toLocaleDateString("en-GB")}.
      </p>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Invitation link</span>
        <input
          readOnly
          value={invite.inviteUrl}
          data-testid="invite-link"
          className="h-10 w-full rounded-md border border-input-border bg-surface px-2 font-mono text-xs text-foreground"
        />
      </label>
    </div>
  );
}
