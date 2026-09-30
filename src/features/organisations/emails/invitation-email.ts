import { escapeHtml } from "@/lib/email/html";
import type { EmailMessage } from "@/lib/email/types";

export type InvitationEmailInput = {
  to: string;
  organisationName: string;
  roleName: string;
  inviteUrl: string;
  expiresAt: string;
  /** Unique per token rotation: the provider sends at most one email per key. */
  idempotencyKey: string;
};

/** Plain, brand-consistent invitation email. All interpolations are escaped. */
export function buildInvitationEmail(input: InvitationEmailInput): EmailMessage {
  const organisation = escapeHtml(input.organisationName);
  const role = escapeHtml(input.roleName);
  const url = escapeHtml(input.inviteUrl);
  const expires = new Date(input.expiresAt).toLocaleDateString("en-GB", { dateStyle: "long" });

  return {
    to: input.to,
    subject: `You're invited to join ${input.organisationName} on CHELTH`,
    idempotencyKey: input.idempotencyKey,
    tags: { category: "organisation_invite" },
    text: [
      `You have been invited to join ${input.organisationName} on CHELTH as ${input.roleName}.`,
      "",
      `Accept the invitation: ${input.inviteUrl}`,
      "",
      `Sign in or create an account with this email address. The invitation expires on ${expires}.`,
      "If you were not expecting this invitation, you can ignore this email.",
    ].join("\n"),
    html: [
      `<h2 style="font-family:sans-serif;color:#0f766e">You're invited to CHELTH</h2>`,
      `<p style="font-family:sans-serif">You have been invited to join <strong>${organisation}</strong> as <strong>${role}</strong>.</p>`,
      `<p style="font-family:sans-serif"><a href="${url}">Accept invitation</a></p>`,
      `<p style="font-family:sans-serif;color:#475569">Sign in or create an account with this email address. The invitation expires on ${escapeHtml(expires)}.</p>`,
      `<p style="font-family:sans-serif;color:#475569">If you were not expecting this invitation, you can ignore this email.</p>`,
    ].join("\n"),
  };
}
