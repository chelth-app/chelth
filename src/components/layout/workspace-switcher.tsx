"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils/cn";

import { ShellGlyph, WorkspaceNavIcon } from "./workspace-nav-icon";

export type ShellWorkspace = {
  id: string;
  name: string;
  typeLabel: string;
  /** The caller's role(s) in this workspace, already resolved to display names. */
  roleLabel: string | null;
  suspended: boolean;
};

export type ShellSwitchTarget = { id: string; name: string; typeLabel: string };

export type ShellUser = { displayName: string | null; email: string | null };

type WorkspaceSwitcherProps = {
  user: ShellUser;
  workspace: ShellWorkspace;
  /** The caller's other memberships (existing ones only; nothing is created here). */
  otherWorkspaces: ShellSwitchTarget[];
  /** `selectOrganisationAction`: re-validates visibility, remembers the choice, redirects. */
  selectWorkspaceAction: (formData: FormData) => Promise<void>;
  signOutAction: () => Promise<void>;
};

function initialsOf(user: ShellUser): string {
  const source = user.displayName?.trim() || user.email?.split("@")[0] || "";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts.at(-1) ?? "";
  const letters = parts.length > 1 ? `${first.charAt(0)}${last.charAt(0)}` : source.slice(0, 2);
  return letters.toUpperCase() || "?";
}

/** Locked menu row: 44 px, teal-tinted hover/focus fill (the global focus ring stays). */
const menuRow =
  "flex min-h-11 w-full items-center gap-3 rounded-[8px] px-3 text-left text-[14px] font-medium text-chelth-navy transition-colors hover:bg-chelth-mint-mist/70 focus-visible:bg-chelth-mint-mist/70";
const sectionLabel =
  "px-3 pt-1 pb-1.5 text-[11.5px] font-semibold tracking-[0.06em] text-slate-500 uppercase";
const divider = "border-t border-[rgba(18,107,103,0.10)]";

function RowIcon({ name }: { name: "operations" | "workforce" | "compliance" }) {
  return (
    <WorkspaceNavIcon
      name={name}
      strokeWidth={1.9}
      className="size-[18px] shrink-0 text-chelth-teal-dark"
    />
  );
}

/**
 * User and workspace control (decision G2): identity, role, the current
 * workspace, switching between the caller's existing memberships, Account,
 * Security and Sign out. A disclosure (not an ARIA menu): plain links and
 * buttons in tab order, Escape or an outside click closes it and returns
 * focus to the trigger.
 */
export function WorkspaceSwitcher({
  user,
  workspace,
  otherWorkspaces,
  selectWorkspaceAction,
  signOutAction,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const currentLabelId = useId();
  const switchLabelId = useId();
  const name = user.displayName?.trim() || user.email || "Signed-in user";

  // While open: an outside pointer press or focus leaving the control closes
  // it; Escape closes it and returns focus to the trigger.
  useEffect(() => {
    const container = containerRef.current;
    if (!open || !container) return;
    function onPointerDown(event: PointerEvent) {
      if (!container?.contains(event.target as Node)) setOpen(false);
    }
    function onFocusOut(event: FocusEvent) {
      if (!container?.contains(event.relatedTarget as Node | null)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    container.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("focusout", onFocusOut);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 items-center gap-3 rounded-md px-1.5 py-1 text-left hover:bg-surface-muted sm:px-2"
      >
        <span
          aria-hidden="true"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-chelth-mint-mist text-[15px] font-semibold text-chelth-teal-dark lg:size-[46px]"
        >
          {initialsOf(user)}
        </span>
        <span className="sr-only">Account and workspace menu:</span>
        <span className="sr-only flex-col sm:not-sr-only sm:flex sm:max-w-56">
          <span className="truncate text-[15px] leading-5 font-semibold text-chelth-navy lg:text-[15.25px] lg:leading-[22px] lg:font-medium">
            {name}
          </span>
          {workspace.roleLabel ? (
            <span className="truncate text-sm leading-5 text-muted-foreground lg:mt-1.5 lg:text-[14px] lg:leading-[22px]">
              {workspace.roleLabel}
            </span>
          ) : null}
        </span>
        <ShellGlyph
          name="chevron-down"
          className={cn("hidden size-4 text-muted-foreground sm:block", open && "rotate-180")}
        />
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="absolute top-full right-0 z-40 mt-2 w-[336px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[rgba(18,107,103,0.14)] bg-white text-chelth-navy shadow-[0_24px_60px_-12px_rgba(9,40,52,0.22),0_8px_20px_rgba(9,40,52,0.08)]"
      >
        {/* A. Identity */}
        <div className="flex items-center gap-3 bg-[linear-gradient(180deg,#f8fcfb,#f1f8f6)] px-4 py-3.5">
          <span
            aria-hidden="true"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-chelth-mint-mist text-[14px] font-semibold text-chelth-teal-dark ring-2 ring-white"
          >
            {initialsOf(user)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] leading-5 font-semibold text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]">
              {name}
            </p>
            {user.displayName && user.email ? (
              <p className="truncate text-[12.5px] leading-[18px] text-slate-600">{user.email}</p>
            ) : null}
          </div>
        </div>

        {/* B. Current workspace (descriptive, not a choice) */}
        <div className={cn(divider, "px-2 pt-2.5 pb-2.5")}>
          <p id={currentLabelId} className={sectionLabel}>
            Current workspace
          </p>
          <div
            aria-labelledby={currentLabelId}
            role="group"
            className="mx-1 flex items-start gap-3 rounded-[10px] border border-[rgba(18,107,103,0.12)] bg-chelth-mint-mist/45 px-3 py-2.5"
          >
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-chelth-teal text-white"
            >
              <ShellGlyph name="check" className="size-3.5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[14px] leading-5 font-semibold text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]">
                {workspace.name}
              </p>
              <p className="text-[12.5px] leading-[18px] text-slate-600">
                {[
                  workspace.typeLabel,
                  workspace.roleLabel,
                  workspace.suspended ? "Suspended" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>
        </div>

        {otherWorkspaces.length > 0 ? (
          <div className={cn(divider, "p-2")}>
            <p id={switchLabelId} className={sectionLabel}>
              Switch workspace
            </p>
            <ul aria-labelledby={switchLabelId} className="flex flex-col">
              {otherWorkspaces.map((target) => (
                <li key={target.id}>
                  <form action={selectWorkspaceAction}>
                    <input type="hidden" name="organisationId" value={target.id} />
                    <button type="submit" className={menuRow}>
                      <span className="min-w-0 flex-1 truncate">{target.name}</span>
                      <span className="text-[12.5px] font-normal text-slate-500">
                        {target.typeLabel}
                      </span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* C. Navigation */}
        <ul className={cn(divider, "flex flex-col p-2")}>
          <li>
            <Link href="/app" className={menuRow}>
              <RowIcon name="operations" />
              All workspaces
            </Link>
          </li>
          <li>
            <Link href="/app/account" className={menuRow}>
              <RowIcon name="workforce" />
              Account
            </Link>
          </li>
          <li>
            <Link href="/app/security" className={menuRow}>
              <RowIcon name="compliance" />
              Security
            </Link>
          </li>
        </ul>

        {/* D. Sign out (separated, restrained) */}
        <form action={signOutAction} className={cn(divider, "p-2")}>
          <button
            type="submit"
            className={cn(menuRow, "font-medium text-slate-600 hover:text-chelth-navy")}
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
