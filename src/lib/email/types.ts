/**
 * Provider-neutral transactional email contract. Domain code builds an
 * EmailMessage and calls an EmailSender; it never imports a provider.
 */
export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Provider-side de-duplication key (same key ⇒ at most one email). */
  idempotencyKey?: string;
  /** Low-cardinality labels for provider analytics. No personal data. */
  tags?: Record<string, string>;
};

export type EmailSendResult =
  | { status: "sent"; provider: string; providerMessageId: string | null }
  | { status: "skipped"; provider: string; reason: "email_delivery_disabled" }
  | { status: "failed"; provider: string; errorCode: EmailErrorCode };

export type EmailErrorCode =
  | "provider_auth"
  | "provider_rejected"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "provider_unreachable";

export interface EmailSender {
  readonly provider: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}
