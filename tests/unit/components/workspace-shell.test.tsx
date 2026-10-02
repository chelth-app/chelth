// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceSidebar } from "@/components/layout/workspace-sidebar";
import type { WorkspaceNavGroup } from "@/components/layout/workspace-navigation-model";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";

const BASE = "/app/organisations/11111111-1111-4111-8111-111111111111";

vi.mock("next/navigation", () => ({
  usePathname: () => `${BASE}/shifts/22222222-2222-4222-8222-222222222222`,
}));

const GROUPS: WorkspaceNavGroup[] = [
  {
    label: "Operations",
    visibleLabel: false,
    items: [
      { label: "Overview", href: BASE, icon: "overview", match: "exact" },
      { label: "Shifts", href: `${BASE}/shifts`, icon: "shifts", match: "prefix" },
    ],
  },
  {
    label: "Finance",
    visibleLabel: true,
    items: [{ label: "Payroll", href: `${BASE}/payroll`, icon: "payroll", match: "prefix" }],
  },
];

describe("WorkspaceSidebar", () => {
  it("renders a labelled navigation landmark with the current section marked", () => {
    render(<WorkspaceSidebar groups={GROUPS} />);
    const nav = screen.getByRole("navigation", { name: "Workspace" });
    expect(within(nav).getByRole("link", { name: "Shifts" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("list", { name: "Finance" })).toBeInTheDocument();
  });

  it("uses the canonical reverse logo", () => {
    render(<WorkspaceSidebar groups={GROUPS} />);
    expect(screen.getByRole("img", { name: /Chelth/ })).toHaveAttribute(
      "src",
      "/brand/chelth/logo-reverse.svg",
    );
  });
});

describe("WorkspaceSwitcher", () => {
  const props = {
    user: { displayName: "Sam Rivera", email: "sam@example.test" },
    workspace: {
      id: "a",
      name: "North Agency",
      typeLabel: "Agency",
      roleLabel: "Scheduler",
      suspended: false,
    },
    selectWorkspaceAction: vi.fn(async () => {}),
    signOutAction: vi.fn(async () => {}),
  };

  it("opens a disclosure with workspace switching, Account, Security and Sign out", async () => {
    render(
      <WorkspaceSwitcher
        {...props}
        otherWorkspaces={[{ id: "b", name: "Riverside Care", typeLabel: "Facility" }]}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Account and workspace menu/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("list", { name: "Switch workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Riverside Care/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All workspaces" })).toHaveAttribute("href", "/app");
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/app/account");
    expect(screen.getByRole("link", { name: "Security" })).toHaveAttribute("href", "/app/security");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    render(<WorkspaceSwitcher {...props} otherWorkspaces={[]} />);
    const trigger = screen.getByRole("button", { name: /Account and workspace menu/ });
    await userEvent.click(trigger);
    await userEvent.tab();
    await userEvent.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("keeps a single-workspace user free of switcher choices", async () => {
    render(<WorkspaceSwitcher {...props} otherWorkspaces={[]} />);
    await userEvent.click(screen.getByRole("button", { name: /Account and workspace menu/ }));
    expect(screen.queryByText("Switch workspace")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Current workspace" })).toHaveTextContent(
      "North Agency",
    );
  });
});
