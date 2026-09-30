import type { EmailErrorCode, EmailSender } from "@/lib/email/types";

import { notificationTemplateSchema, renderNotification } from "./templates";

/**
 * Outbox consumer (P0-E5-S2). Provider-neutral: depends on a store (claim /
 * complete, implemented by the database functions) and an EmailSender.
 *
 * Guarantees (see docs/architecture/NOTIFICATION_DELIVERY.md):
 * - a row is processed by at most one dispatcher at a time (SKIP LOCKED + lease);
 * - a stale dispatcher cannot overwrite a newer outcome (claim token);
 * - the provider idempotency key is stable per outbox row, so a retry after
 *   an unrecorded success does not send a second email (within the
 *   provider's idempotency window);
 * - retries are bounded; permanent errors fail immediately.
 * Nothing here logs addresses, subjects or bodies.
 */
export type ClaimedNotification = {
  notificationId: string;
  event: string;
  attempt: number;
  claimToken: string;
  recipientEmail: string;
  template: unknown;
};

export type CompletionOutcome = "sent" | "transient_failure" | "permanent_failure";

export type NotificationStore = {
  claim(limit: number, leaseSeconds: number): Promise<ClaimedNotification[]>;
  complete(input: {
    notificationId: string;
    claimToken: string;
    outcome: CompletionOutcome;
    provider: string;
    providerMessageId?: string | null;
    errorCode?: string | null;
  }): Promise<string>;
};

export type DispatchLogger = {
  info(message: string, context: Record<string, unknown>): void;
  warn(message: string, context: Record<string, unknown>): void;
};

export type DispatchResult = {
  status: "completed" | "email_disabled";
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
};

/** Provider errors that will not succeed on retry. */
const PERMANENT: ReadonlySet<EmailErrorCode> = new Set(["provider_rejected"]);

export function classifyProviderError(code: EmailErrorCode): CompletionOutcome {
  return PERMANENT.has(code) ? "permanent_failure" : "transient_failure";
}

export function idempotencyKeyFor(notificationId: string): string {
  return `chelth-notification-${notificationId}`;
}

export async function dispatchNotifications(options: {
  store: NotificationStore;
  sender: EmailSender;
  baseUrl: string;
  batchSize?: number;
  leaseSeconds?: number;
  logger?: DispatchLogger;
}): Promise<DispatchResult> {
  const { store, sender, baseUrl, logger } = options;
  const result: DispatchResult = {
    status: "completed",
    claimed: 0,
    sent: 0,
    retrying: 0,
    failed: 0,
  };
  // With delivery disabled, nothing is claimed: rows stay pending until a provider is configured.
  if (sender.provider === "disabled") return { ...result, status: "email_disabled" };

  const claimed = await store.claim(options.batchSize ?? 25, options.leaseSeconds ?? 120);
  result.claimed = claimed.length;

  for (const item of claimed) {
    let outcome: CompletionOutcome;
    let errorCode: string | null = null;
    let providerMessageId: string | null = null;

    const parsed = notificationTemplateSchema.safeParse(item.template);
    if (!parsed.success) {
      outcome = "permanent_failure";
      errorCode = "template_invalid";
    } else {
      try {
        const rendered = renderNotification(parsed.data, baseUrl);
        const sent = await sender.send({
          to: item.recipientEmail,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          idempotencyKey: idempotencyKeyFor(item.notificationId),
          tags: { category: item.event },
        });
        if (sent.status === "sent") {
          outcome = "sent";
          providerMessageId = sent.providerMessageId;
        } else if (sent.status === "failed") {
          outcome = classifyProviderError(sent.errorCode);
          errorCode = sent.errorCode;
        } else {
          outcome = "transient_failure";
          errorCode = "dispatch_error";
        }
      } catch {
        outcome = "transient_failure";
        errorCode = "dispatch_error";
      }
    }

    const state = await store.complete({
      notificationId: item.notificationId,
      claimToken: item.claimToken,
      outcome,
      provider: sender.provider,
      providerMessageId,
      errorCode,
    });
    if (state === "sent") result.sent += 1;
    else if (state === "retry") result.retrying += 1;
    else if (state === "failed") result.failed += 1;

    const context = {
      notificationId: item.notificationId,
      event: item.event,
      attempt: item.attempt,
      state,
      errorCode,
    };
    if (state === "sent") logger?.info("Notification delivered", context);
    else logger?.warn("Notification not delivered", context);
  }
  return result;
}
