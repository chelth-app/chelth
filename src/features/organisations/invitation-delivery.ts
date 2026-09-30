import "server-only";

import { getEmailSender } from "@/lib/email";
import { logger } from "@/lib/logging";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { buildInvitationEmail } from "./emails/invitation-email";

export type InvitationDelivery = "sent" | "skipped" | "failed";

/**
 * Post-commit invitation delivery (docs/architecture/TRANSACTIONAL_EMAIL.md).
 *
 * Called only AFTER the invite RPC has committed. It sends the email with the
 * raw token held in memory, then records the outcome on the invite so a
 * failure is never silent. It never throws: delivery problems must not turn a
 * committed invitation into an error for the issuer. Logs contain identifiers
 * and result codes only — never the recipient, link or body.
 */
export async function deliverInvitation(input: {
  inviteId: string;
  email: string;
  inviteUrl: string;
  expiresAt: string;
  organisationName: string;
  roleName: string;
}): Promise<InvitationDelivery> {
  const sender = getEmailSender();
  const result = await sender.send(
    buildInvitationEmail({
      to: input.email,
      organisationName: input.organisationName,
      roleName: input.roleName,
      inviteUrl: input.inviteUrl,
      expiresAt: input.expiresAt,
      idempotencyKey: `invite-${input.inviteId}-${new Date(input.expiresAt).getTime()}`,
    }),
  );

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_organisation_invite_delivery", {
    p_invite_id: input.inviteId,
    p_status: result.status,
    p_provider: result.provider,
    ...(result.status === "sent" && result.providerMessageId
      ? { p_message_id: result.providerMessageId }
      : {}),
    ...(result.status === "failed" ? { p_error_code: result.errorCode } : {}),
  });

  const context = {
    inviteId: input.inviteId,
    provider: result.provider,
    deliveryStatus: result.status,
    ...(result.status === "failed" ? { errorCode: result.errorCode } : {}),
    ...(error ? { recordErrorCode: error.code } : {}),
  };
  if (result.status === "failed" || error) logger.warn("Invitation email not delivered", context);
  else logger.info("Invitation email processed", context);

  return result.status;
}
