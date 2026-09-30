import { describe, expect, it, vi } from "vitest";

import { parseServerEnv } from "@/config/env.server.schema";
import { buildInvitationEmail } from "@/features/organisations/emails/invitation-email";
import { disabledEmailSender } from "@/lib/email/disabled-sender";
import { escapeHtml } from "@/lib/email/html";
import { createResendSender } from "@/lib/email/resend-sender";

const message = {
  to: "ivy@example.test",
  subject: "Subject",
  html: "<p>Hi</p>",
  text: "Hi",
  idempotencyKey: "invite-123-456",
  tags: { category: "organisation_invite" },
};

function fakeFetch(response: Response | Error) {
  return vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
}

describe("Resend sender", () => {
  it("posts the message with auth, idempotency key and tags, and returns the message id", async () => {
    const fetchImpl = fakeFetch(Response.json({ id: "msg_123" }));
    const sender = createResendSender({
      apiKey: "re_test_key_value_1234567890",
      from: "CHELTH <no-reply@example.test>",
      fetchImpl,
    });

    const result = await sender.send(message);

    expect(result).toEqual({ status: "sent", provider: "resend", providerMessageId: "msg_123" });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key_value_1234567890");
    expect(headers["Idempotency-Key"]).toBe("invite-123-456");
    expect(JSON.parse(String(init?.body))).toEqual({
      from: "CHELTH <no-reply@example.test>",
      to: ["ivy@example.test"],
      subject: "Subject",
      html: "<p>Hi</p>",
      text: "Hi",
      tags: [{ name: "category", value: "organisation_invite" }],
    });
  });

  it.each([
    [401, "provider_auth"],
    [403, "provider_auth"],
    [422, "provider_rejected"],
    [429, "provider_rate_limited"],
    [503, "provider_unavailable"],
  ])("maps HTTP %i to %s", async (status, errorCode) => {
    const sender = createResendSender({
      apiKey: "re_key",
      from: "a@b.test",
      fetchImpl: fakeFetch(new Response("{}", { status })),
    });
    expect(await sender.send(message)).toEqual({ status: "failed", provider: "resend", errorCode });
  });

  it("reports network failures and timeouts as unreachable (never throws)", async () => {
    const sender = createResendSender({
      apiKey: "re_key",
      from: "a@b.test",
      fetchImpl: fakeFetch(new Error("ECONNRESET")),
    });
    expect(await sender.send(message)).toEqual({
      status: "failed",
      provider: "resend",
      errorCode: "provider_unreachable",
    });
  });
});

describe("disabled sender", () => {
  it("never sends and reports skipped", async () => {
    expect(await disabledEmailSender.send(message)).toEqual({
      status: "skipped",
      provider: "disabled",
      reason: "email_delivery_disabled",
    });
  });
});

describe("invitation email", () => {
  it("escapes organisation and role names in HTML", () => {
    const email = buildInvitationEmail({
      to: "ivy@example.test",
      organisationName: `<script>alert("x")</script> & Co`,
      roleName: "Healthcare Worker",
      inviteUrl: "https://app.example.test/invite/abc",
      expiresAt: "2026-10-07T10:00:00Z",
      idempotencyKey: "invite-1-2",
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain('href="https://app.example.test/invite/abc"');
    expect(email.text).toContain("https://app.example.test/invite/abc");
    expect(email.tags).toEqual({ category: "organisation_invite" });
  });

  it("escapes all HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});

describe("email configuration", () => {
  it("defaults to disabled", () => {
    expect(parseServerEnv({}).EMAIL_PROVIDER).toBe("disabled");
  });

  it("requires a key and sender when Resend is selected", () => {
    expect(() => parseServerEnv({ EMAIL_PROVIDER: "resend" })).toThrow(
      /RESEND_API_KEY[\s\S]*EMAIL_FROM/,
    );
  });

  it("accepts a complete Resend configuration", () => {
    expect(
      parseServerEnv({
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "re_0123456789abcdefghij",
        EMAIL_FROM: "CHELTH <no-reply@mail.example.test>",
      }).EMAIL_PROVIDER,
    ).toBe("resend");
  });

  it("rejects malformed sender addresses", () => {
    expect(() =>
      parseServerEnv({
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "re_0123456789abcdefghij",
        EMAIL_FROM: "not an address",
      }),
    ).toThrow(/EMAIL_FROM/);
  });
});
