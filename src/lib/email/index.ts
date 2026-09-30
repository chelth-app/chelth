import "server-only";

import { serverEnv } from "@/config/env.server";

import { disabledEmailSender } from "./disabled-sender";
import { createResendSender } from "./resend-sender";
import type { EmailSender } from "./types";

export type { EmailMessage, EmailSender, EmailSendResult } from "./types";
export { escapeHtml } from "./html";

/**
 * The configured sender. Selection is configuration-gated (EMAIL_PROVIDER);
 * environment validation guarantees the provider's secrets are present.
 */
export function getEmailSender(): EmailSender {
  if (serverEnv.EMAIL_PROVIDER === "resend" && serverEnv.RESEND_API_KEY && serverEnv.EMAIL_FROM) {
    return createResendSender({ apiKey: serverEnv.RESEND_API_KEY, from: serverEnv.EMAIL_FROM });
  }
  return disabledEmailSender;
}
