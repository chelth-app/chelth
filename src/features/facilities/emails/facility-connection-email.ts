import { escapeHtml } from "@/lib/email/html";
import type { EmailMessage } from "@/lib/email/types";

export type FacilityConnectionEmailInput = {
  to: string;
  agencyName: string;
  facilityName: string;
  inviteUrl: string;
  expiresAt: string;
  /** Unique per token rotation: the provider sends at most one email per key. */
  idempotencyKey: string;
};

/**
 * P0-E9-4A.1: an agency asks a facility representative to connect on Chelth.
 * Names only: no rates, workers, notes or internal IDs. All values escaped.
 */
export function buildFacilityConnectionEmail(input: FacilityConnectionEmailInput): EmailMessage {
  const agency = escapeHtml(input.agencyName);
  const facility = escapeHtml(input.facilityName);
  const url = escapeHtml(input.inviteUrl);
  const expires = new Date(input.expiresAt).toLocaleDateString("en-US", { dateStyle: "long" });
  return {
    to: input.to,
    subject: `${input.agencyName} would like to connect with ${input.facilityName} on Chelth`,
    idempotencyKey: input.idempotencyKey,
    tags: { category: "facility_connection" },
    text: [
      `${input.agencyName} would like to connect with ${input.facilityName} on Chelth.`,
      "",
      "Connecting lets your facility request staff from this agency and follow coverage, attendance and compliance in your own Chelth workspace.",
      "",
      `Review the invitation: ${input.inviteUrl}`,
      "",
      `Sign in or create an account with this email address. The invitation expires on ${expires}.`,
      "If you were not expecting this invitation, you can ignore this email.",
    ].join("\n"),
    html: [
      `<h2 style="font-family:sans-serif;color:#126B67">${agency} would like to connect on Chelth</h2>`,
      `<p style="font-family:sans-serif"><strong>${agency}</strong> would like to connect with <strong>${facility}</strong> on Chelth.</p>`,
      `<p style="font-family:sans-serif">Connecting lets your facility request staff from this agency and follow coverage, attendance and compliance in your own Chelth workspace.</p>`,
      `<p style="font-family:sans-serif"><a href="${url}">Review invitation</a></p>`,
      `<p style="font-family:sans-serif;color:#475569">Sign in or create an account with this email address. The invitation expires on ${escapeHtml(expires)}.</p>`,
      `<p style="font-family:sans-serif;color:#475569">If you were not expecting this invitation, you can ignore this email.</p>`,
    ].join("\n"),
  };
}
