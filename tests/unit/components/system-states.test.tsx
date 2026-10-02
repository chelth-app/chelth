// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

import PersonalError from "@/app/app/(personal)/error";
import WorkerError from "@/app/app/organisations/[organisationId]/(self-service)/error";
import WorkspaceError from "@/app/app/organisations/[organisationId]/(workspace)/error";
import { SystemState } from "@/components/ui/system-state";
import { ERROR_CODES } from "@/lib/errors/error-codes";

type ErrorBoundary = ComponentType<{ error: Error & { digest?: string }; reset: () => void }>;

describe("SystemState", () => {
  it("renders the page h1, one explanation and one action; not-found is not an alert", () => {
    render(
      <SystemState
        title="Page not found"
        description="This page does not exist, or it is not available to you."
        action={<a href="/app">Back to your workspaces</a>}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to your workspaces" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe.each<[string, ErrorBoundary]>([
  ["workspace", WorkspaceError],
  ["worker", WorkerError],
  ["personal", PersonalError],
])("%s error boundary", (_name, Boundary) => {
  it("announces a safe message with the support reference and a retry", async () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("db password=secret at line 42"), { digest: "d1g35t" });
    render(<Boundary error={error} reset={reset} />);
    const alert = screen.getByRole("alert");
    expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
    expect(alert).toHaveTextContent(ERROR_CODES.INTERNAL.message);
    expect(alert).toHaveTextContent("Reference: d1g35t");
    // Implementation details never leak.
    expect(alert).not.toHaveTextContent(/secret|line 42/);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
