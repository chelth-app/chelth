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
    <header className="sticky top-0 z-30 bg-background lg:bg-[rgba(240,247,253,0.78)] lg:backdrop-blur-[10px] lg:backdrop-saturate-150">
      <div className="flex min-h-[68px] items-center gap-3 px-4 sm:px-6 lg:min-h-[76px] lg:pr-[19px] lg:pl-[30px]">
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
          {/* Below lg: the workspace identity heads the bar. */}
          <div className="lg:hidden">
            <p className="truncate font-display text-[17px] leading-6 font-semibold text-chelth-navy">
              {workspace.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {workspace.typeLabel} workspace
              {workspace.suspended ? " · Suspended" : ""}
            </p>
          </div>
          {/*
            Locked P1 (lg+): the reference has a search field here, which Chelth
            does not have. The workspace identity sits quietly on that line
            instead, leaving the open space of the reference bar.
          */}
          <p className="hidden truncate text-[13px] leading-5 text-muted-foreground lg:block">
            <span className="font-medium text-slate-600">{workspace.name}</span>
            <span aria-hidden="true"> · </span>
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
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[214px_minmax(0,1fr)] lg:bg-[radial-gradient(120%_60%_at_100%_100%,rgba(196,234,224,0.35),transparent_60%),linear-gradient(180deg,#fafcfe_0%,#f6fafc_45%,#f1f9fa_100%)]">
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
        <main id={MAIN_CONTENT_ID} className="flex-1 pt-3 pb-10 lg:pt-2.5">
          <PageContainer size="wide" className="flex flex-col gap-5">
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
