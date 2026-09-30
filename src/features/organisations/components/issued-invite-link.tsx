import type { IssuedInvite } from "../actions";

/**
 * Shows a freshly issued invitation link exactly once. Email delivery is a
 * later stage; until then the issuer shares the link through a trusted channel.
 */
export function IssuedInviteLink({ invite }: { invite: IssuedInvite }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-md bg-success-soft p-3 text-sm text-success-soft-foreground"
    >
      <p>
        Invitation ready
        {invite.email ? (
          <>
            {" "}
            for <strong>{invite.email}</strong>
          </>
        ) : null}
        . Share this link with them — it is shown only once and expires on{" "}
        {new Date(invite.expiresAt).toLocaleDateString("en-GB")}.
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
