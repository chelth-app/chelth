// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IssuedInviteLink } from "@/components/shared/issued-invite-link";

/*
 * What the issuer sees after (re-)issuing an invitation. The link is shown
 * once ONLY when the email was not sent; after a successful send it is never
 * exposed. A re-issue says the previous link no longer works.
 */
const base = {
  email: "wren@example.test",
  expiresAt: "2026-10-16T00:00:00Z",
};

describe("IssuedInviteLink", () => {
  it("confirms a resend without exposing the link when the email was sent", () => {
    render(
      <IssuedInviteLink invite={{ ...base, delivery: "sent", inviteUrl: null, reissued: true }} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Invitation resent to wren@example.test");
    expect(screen.getByRole("status")).toHaveTextContent(
      "previous invitation link no longer works",
    );
    expect(screen.queryByTestId("invite-link")).toBeNull();
  });

  it("never shows a link after a successful send, even if one is passed", () => {
    render(
      <IssuedInviteLink
        invite={{ ...base, delivery: "sent", inviteUrl: "https://app.chelth.test/invite/x" }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Invitation emailed to wren@example.test");
    expect(screen.queryByTestId("invite-link")).toBeNull();
  });

  it("falls back to the one-time link when the re-issued email could not be sent", () => {
    render(
      <IssuedInviteLink
        invite={{
          ...base,
          delivery: "failed",
          inviteUrl: "https://app.chelth.test/invite/new-token",
          reissued: true,
        }}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Invitation re-issued for wren@example.test");
    expect(status).toHaveTextContent("The previous invitation link no longer works.");
    expect(status).toHaveTextContent("The invitation email could not be sent");
    expect(status).toHaveTextContent("shown only once");
    expect(screen.getByTestId("invite-link")).toHaveValue(
      "https://app.chelth.test/invite/new-token",
    );
  });
});
