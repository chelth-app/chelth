"use client";

import { useId, useState, type ReactNode } from "react";

import { BrandLogo } from "@/components/shared/brand-logo";

import { MobileWorkspaceNav } from "./mobile-workspace-nav";
import { PageContainer } from "./page-container";
import { MAIN_CONTENT_ID } from "./skip-link";
import { ShellGlyph } from "./workspace-nav-icon";
import type { WorkspaceNavGroup } from "./workspace-navigation-model";
import { WorkspaceSidebar } from "./workspace-sidebar";
import {
  type ShellSwitchTarget,
  type ShellUser,
  type ShellWorkspace,
  WorkspaceSwitcher,
} from "./workspace-switcher";

type WorkspaceHeaderProps = {
  workspace: ShellWorkspace;
  user: ShellUser;
  otherWorkspaces: ShellSwitchTarget[];
  selectWorkspaceAction: (formData: FormData) => Promise<void>;
  signOutAction: () => Promise<void>;
  navigationId: string;
  navigationOpen: boolean;
  onOpenNavigation: () => void;
};

/**
 * Workspace top bar: the navigation trigger (narrow viewports only), the
 * current workspace, and the user/workspace control. Deliberately no search
 * field and no notification bell (decision F10): neither feature exists yet.
 */
export function WorkspaceHeader({
  workspace,
  navigationId,
  navigationOpen,
  onOpenNavigation,
  ...switcher
}: WorkspaceHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background">
      <div className="flex min-h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={navigationOpen}
          aria-controls={navigationId}
          onClick={onOpenNavigation}
          className="-ml-1.5 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-chelth-navy hover:bg-surface-muted lg:hidden"
        >
          <ShellGlyph name="menu" className="size-6" />
          <span className="sr-only">Open navigation</span>
        </button>
        <BrandLogo variant="mark" height={28} decorative className="shrink-0 lg:hidden" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-semibold text-chelth-navy">
            {workspace.name}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {workspace.typeLabel} workspace
            {workspace.suspended ? " · Suspended" : ""}
          </p>
        </div>
        <WorkspaceSwitcher workspace={workspace} {...switcher} />
      </div>
    </header>
  );
}

type AppShellProps = Omit<
  WorkspaceHeaderProps,
  "navigationId" | "navigationOpen" | "onOpenNavigation"
> & {
  navigation: WorkspaceNavGroup[];
  children: ReactNode;
};

/**
 * Shared authenticated Agency / Facility shell (P1, P0-E8-S1).
 *
 * Desktop (lg and up): persistent dark-teal sidebar + top bar + off-white
 * canvas. Below lg the sidebar is not rendered in the page; the top-bar
 * trigger opens the same sidebar as a modal overlay.
 */
export function AppShell({ navigation, children, ...header }: AppShellProps) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationId = useId();

  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside aria-label="Workspace sidebar" className="hidden lg:sticky lg:top-0 lg:block lg:h-dvh">
        <WorkspaceSidebar groups={navigation} />
      </aside>
      <div className="flex min-h-dvh min-w-0 flex-col">
        <WorkspaceHeader
          {...header}
          navigationId={navigationId}
          navigationOpen={navigationOpen}
          onOpenNavigation={() => setNavigationOpen(true)}
        />
        <main id={MAIN_CONTENT_ID} className="flex-1 py-6 lg:py-8">
          <PageContainer size="wide" className="flex flex-col gap-8">
            {children}
          </PageContainer>
        </main>
      </div>
      <MobileWorkspaceNav
        id={navigationId}
        open={navigationOpen}
        onOpenChange={setNavigationOpen}
        groups={navigation}
      />
    </div>
  );
}
