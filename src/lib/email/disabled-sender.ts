import type { EmailSender } from "./types";

/** Default until a provider is configured: never sends, reports "skipped". */
export const disabledEmailSender: EmailSender = {
  provider: "disabled",
  async send() {
    return { status: "skipped", provider: "disabled", reason: "email_delivery_disabled" };
  },
};
