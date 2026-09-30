import { describe, expect, it, vi } from "vitest";

import { parseServerEnv } from "@/config/env.server.schema";
import { decodeCursor, encodeCursor } from "@/features/shifts/cursor";
import type { EmailMessage, EmailSender, EmailSendResult } from "@/lib/email/types";
import {
  classifyProviderError,
  type ClaimedNotification,
  dispatchNotifications,
  idempotencyKeyFor,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_EVENTS,
  type NotificationStore,
  type NotificationTemplateData,
  renderNotification,
} from "@/lib/notifications";
import { isAuthorizedDispatch } from "@/lib/notifications/dispatch-auth";

const ORG = "11111111-1111-4111-8111-111111111111";
const BASE = "https://app.chelth.example";

function template(overrides: Partial<NotificationTemplateData> = {}): NotificationTemplateData {
  return {
    event: "worker_assigned",
    audience: "worker",
    path: `/app/organisations/${ORG}/my-shifts`,
    recipientName: "Wendy",
    agencyName: "Alpha Care",
    facilityName: "Mercy Rehab",
    locationName: "Mercy Main",
    disciplineName: "Certified Nursing Assistant (CNA)",
    startAt: "2030-07-15T23:00:00Z",
    endAt: "2030-07-16T11:00:00Z",
    timezone: "America/New_York",
    ...overrides,
  };
}

describe("notification templates", () => {
  it("render every event with safe operational content and a canonical link", () => {
    for (const event of NOTIFICATION_EVENTS) {
      const rendered = renderNotification(
        template({ event, audience: "agency", workerName: "Walt" }),
        BASE,
      );
      expect(rendered.subject.length).toBeGreaterThan(5);
      expect(rendered.text).toContain(`${BASE}/app/organisations/${ORG}/my-shifts`);
      expect(rendered.html).toContain('lang="en"');
      expect(rendered.html).toContain('alt="CHELTH"');
    }
  });

  it("shows local time, timezone and date without raw ids in visible text", () => {
    const rendered = renderNotification(template(), BASE);
    expect(rendered.subject).toBe("New shift assignment: Mercy Rehab, Mon, Jul 15, 2030");
    expect(rendered.text).toContain("Time: 7:00 PM – 7:00 AM (+1 day) EDT");
    expect(rendered.text).toContain("Timezone: America/New_York");
    const visible = rendered.text.replace(/https?:\/\/\S+/g, "");
    expect(visible).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("escapes every interpolated value (template injection)", () => {
    const rendered = renderNotification(
      template({
        facilityName: '<script>alert("x")</script>',
        recipientName: "<img src=x onerror=1>",
      }),
      BASE,
    );
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("<img src=x");
    expect(rendered.html).toContain("&lt;script&gt;");
  });

  it("keeps compliance detail out of non-compliance emails", () => {
    const rendered = renderNotification(
      template({ event: "assignment_non_compliant", audience: "agency", workerName: "Walt" }),
      BASE,
    );
    expect(rendered.text).toContain("Walt no longer meets the requirements");
    expect(rendered.text).not.toMatch(/expired|credential|BLS/i);
  });

  it("every event is a required operational notification today", () => {
    expect(Object.values(NOTIFICATION_CATEGORY).every((category) => category === "required")).toBe(
      true,
    );
  });
});

function fakeSender(results: EmailSendResult[]): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    provider: "fake",
    sent,
    async send(message) {
      sent.push(message);
      return results.shift() ?? { status: "sent", provider: "fake", providerMessageId: "m" };
    },
  };
}

function fakeStore(items: ClaimedNotification[]) {
  const completions: Parameters<NotificationStore["complete"]>[0][] = [];
  const store: NotificationStore = {
    claim: vi.fn(async () => items),
    async complete(input) {
      completions.push(input);
      return input.outcome === "sent"
        ? "sent"
        : input.outcome === "transient_failure"
          ? "retry"
          : "failed";
    },
  };
  return { store, completions };
}

function claimed(id: string, overrides: Partial<ClaimedNotification> = {}): ClaimedNotification {
  return {
    notificationId: id,
    event: "worker_assigned",
    attempt: 1,
    claimToken: `token-${id}`,
    recipientEmail: `${id}@example.test`,
    template: template(),
    ...overrides,
  };
}

describe("dispatchNotifications", () => {
  it("sends, records provider ids and uses a stable idempotency key per outbox row", async () => {
    const sender = fakeSender([{ status: "sent", provider: "fake", providerMessageId: "msg-1" }]);
    const { store, completions } = fakeStore([claimed("a")]);
    const result = await dispatchNotifications({ store, sender, baseUrl: BASE });
    expect(result).toMatchObject({ claimed: 1, sent: 1, retrying: 0, failed: 0 });
    expect(sender.sent[0]?.idempotencyKey).toBe(idempotencyKeyFor("a"));
    expect(completions[0]).toMatchObject({
      outcome: "sent",
      providerMessageId: "msg-1",
      claimToken: "token-a",
    });
  });

  it("classifies provider failures: rejected is permanent, availability problems retry", async () => {
    expect(classifyProviderError("provider_rejected")).toBe("permanent_failure");
    for (const code of [
      "provider_unavailable",
      "provider_rate_limited",
      "provider_unreachable",
      "provider_auth",
    ] as const) {
      expect(classifyProviderError(code)).toBe("transient_failure");
    }
    const sender = fakeSender([
      { status: "failed", provider: "fake", errorCode: "provider_unavailable" },
      { status: "failed", provider: "fake", errorCode: "provider_rejected" },
    ]);
    const { store, completions } = fakeStore([claimed("a"), claimed("b")]);
    const result = await dispatchNotifications({ store, sender, baseUrl: BASE });
    expect(result).toMatchObject({ retrying: 1, failed: 1 });
    expect(completions.map((c) => c.errorCode)).toEqual([
      "provider_unavailable",
      "provider_rejected",
    ]);
  });

  it("fails an invalid template permanently without calling the provider", async () => {
    const sender = fakeSender([]);
    const { store, completions } = fakeStore([
      claimed("a", { template: { event: "worker_assigned", path: "https://evil" } }),
    ]);
    await dispatchNotifications({ store, sender, baseUrl: BASE });
    expect(sender.sent).toHaveLength(0);
    expect(completions[0]).toMatchObject({
      outcome: "permanent_failure",
      errorCode: "template_invalid",
    });
  });

  it("claims nothing while email delivery is disabled", async () => {
    const { store } = fakeStore([claimed("a")]);
    const disabled: EmailSender = {
      provider: "disabled",
      send: async () => ({
        status: "skipped",
        provider: "disabled",
        reason: "email_delivery_disabled",
      }),
    };
    const result = await dispatchNotifications({ store, sender: disabled, baseUrl: BASE });
    expect(result.status).toBe("email_disabled");
    expect(store.claim).not.toHaveBeenCalled();
  });

  it("never logs addresses or subjects", async () => {
    const lines: string[] = [];
    const logger = {
      info: (message: string, context: Record<string, unknown>) =>
        lines.push(message + JSON.stringify(context)),
      warn: (message: string, context: Record<string, unknown>) =>
        lines.push(message + JSON.stringify(context)),
    };
    const { store } = fakeStore([claimed("a")]);
    await dispatchNotifications({ store, sender: fakeSender([]), baseUrl: BASE, logger });
    expect(lines.join("\n")).not.toMatch(/@|Mercy|New shift/);
  });
});

describe("dispatch route authorization", () => {
  const secret = "s".repeat(40);
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedDispatch(`Bearer ${secret}`, secret)).toBe(true);
    expect(isAuthorizedDispatch(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorizedDispatch(secret, secret)).toBe(false);
    expect(isAuthorizedDispatch(null, secret)).toBe(false);
  });
});

describe("keyset cursor", () => {
  it("round-trips and rejects tampered input", () => {
    const cursor = {
      startAt: "2030-01-15T12:00:00+00:00",
      id: "22222222-2222-4222-8222-222222222222",
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor(Buffer.from("x|' or 1=1").toString("base64url"))).toBeNull();
  });
});

describe("notification environment", () => {
  it("requires https for APP_BASE_URL outside local development", () => {
    expect(() =>
      parseServerEnv({
        APP_BASE_URL: "http://app.chelth.example",
        NOTIFICATION_WORKER_DATABASE_URL: "postgresql://u:p@db.example/postgres",
      }),
    ).toThrow(/https/);
    expect(
      parseServerEnv({
        APP_BASE_URL: "http://localhost:3000/",
        NOTIFICATION_WORKER_DATABASE_URL: "postgresql://u:p@127.0.0.1:55322/postgres",
      }).APP_BASE_URL,
    ).toBe("http://localhost:3000");
  });

  it("rejects a short dispatch secret", () => {
    expect(() => parseServerEnv({ NOTIFICATION_DISPATCH_SECRET: "short" })).toThrow();
  });
});
