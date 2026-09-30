import type { EmailErrorCode, EmailMessage, EmailSender, EmailSendResult } from "./types";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

function errorCodeForStatus(status: number): EmailErrorCode {
  if (status === 401 || status === 403) return "provider_auth";
  if (status === 429) return "provider_rate_limited";
  if (status >= 500) return "provider_unavailable";
  return "provider_rejected";
}

/**
 * Resend adapter (https://resend.com/docs/api-reference/emails/send-email).
 * The API key stays server-side. Message bodies and recipients are never
 * logged here; callers log identifiers and result codes only.
 */
export function createResendSender(config: {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
}): EmailSender {
  const fetchImpl = config.fetchImpl ?? fetch;
  return {
    provider: "resend",
    async send(message: EmailMessage): Promise<EmailSendResult> {
      try {
        const response = await fetchImpl(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
          },
          body: JSON.stringify({
            from: config.from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
            ...(message.tags
              ? { tags: Object.entries(message.tags).map(([name, value]) => ({ name, value })) }
              : {}),
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!response.ok) {
          return {
            status: "failed",
            provider: "resend",
            errorCode: errorCodeForStatus(response.status),
          };
        }
        const body = (await response.json().catch(() => ({}))) as { id?: unknown };
        return {
          status: "sent",
          provider: "resend",
          providerMessageId: typeof body.id === "string" ? body.id.slice(0, 200) : null,
        };
      } catch {
        return { status: "failed", provider: "resend", errorCode: "provider_unreachable" };
      }
    },
  };
}
