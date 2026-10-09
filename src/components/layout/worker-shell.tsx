"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { InitialsAvatar } from "@/components/reference/locked-reference";
import { BrandLogo } from "@/components/shared/brand-logo";
import { cn } from "@/lib/utils/cn";

import { MAIN_CONTENT_ID } from "./skip-link";
import { ShellGlyph } from "./workspace-nav-icon";

export type WorkerNavItem = {
  label: string;
  href: string;
  icon: "shifts" | "timesheets" | "credentials";
};

type WorkerShellProps = {
  workspaceName: string;
  user: { displayName: string | null; email: string | null };
  /** Real worker destinations only (decided on the server). */
  items: WorkerNavItem[];
  homeHref: string;
  /** The caller's other memberships (existing ones only). */
  otherWorkspaces: { id: string; name: string; typeLabel: string }[];
  selectWorkspaceAction: (formData: FormData) => Promise<void>;
  signOutAction: () => Promise<void>;
  children: ReactNode;
};

const ICONS: Record<WorkerNavItem["icon"] | "more", ReactNode> = {
  shifts: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  timesheets: (
    <>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M10 13h6M10 17h6" />
    </>
  ),
  credentials: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.3 7.5 9.5 4.3-1.2 7.5-5 7.5-9.5V6z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.25" />
      <circle cx="12" cy="12" r="1.25" />
      <circle cx="19" cy="12" r="1.25" />
    </>
  ),
};

function NavIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="size-6"
    >
      {ICONS[name]}
    </svg>
  );
}

const sheetRow =
  "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-base text-foreground hover:bg-surface-muted";

/**
 * Worker self-service shell (P7; locked Worker Mobile reference, P0-E8-W1).
 * Mobile-first: compact header with the Chelth mark, workspace and the
 * worker's initials; one content column on the locked off-white canvas; a
 * bottom navigation of real worker destinations (teal current item with a top
 * rule, 64 px targets, safe-area padding); and a "More" sheet for workspace
 * home, switching, Account, Security and Sign out. Never the Agency sidebar;
 * at wider widths it stays a centred phone-width column.
 */
export function WorkerShell({
  workspaceName,
  user,
  items,
  homeHref,
  otherWorkspaces,
  selectWorkspaceAction,
  signOutAction,
  children,
}: WorkerShellProps) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const sheetRef = useRef<HTMLDialogElement>(null);
  const sheetId = useId();
  const titleId = useId();
  const switchId = useId();
  const name = user.displayName?.trim() || user.email || "You";

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (moreOpen && !sheet.open) sheet.showModal();
    if (!moreOpen && sheet.open) sheet.close();
  }, [moreOpen]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    function onBackdropClick(event: MouseEvent) {
      if (event.target === sheet) setMoreOpen(false);
    }
    sheet.addEventListener("click", onBackdropClick);
    return () => sheet.removeEventListener("click", onBackdropClick);
  }, []);

  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex min-h-dvh flex-col bg-[linear-gradient(180deg,#fafcfe_0%,#f6fafc_55%,#f1f9fa_100%)]">
      <header className="sticky top-0 z-30 border-b border-[rgba(18,107,103,0.10)] bg-white/95 backdrop-blur-[6px]">
        <div className="mx-auto flex min-h-16 w-full max-w-xl items-center gap-3 px-4">
          <Link href={homeHref as Route} className="shrink-0 rounded-sm">
            <BrandLogo variant="mark" height={30} />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[16px] leading-5 font-semibold text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]">
              {workspaceName}
            </p>
            <p className="truncate text-[12.5px] leading-[18px] text-slate-600">Worker · {name}</p>
          </div>
          <InitialsAvatar name={user.displayName ?? user.email} />
        </div>
      </header>

      <main id={MAIN_CONTENT_ID} className="flex-1 pt-5 pb-28">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4">{children}</div>
      </main>

      <nav
        aria-label="Worker"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-[rgba(18,107,103,0.12)] bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_18px_rgba(13,47,66,0.06)]"
      >
        <ul className="mx-auto grid w-full max-w-xl auto-cols-fr grid-flow-col">
          {items.map((item) => {
            const current = isCurrent(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href as Route}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-16 flex-col items-center justify-center gap-1 px-2 text-[12px] font-medium",
                    current
                      ? "font-semibold text-chelth-teal-dark before:absolute before:inset-x-5 before:top-0 before:h-[3px] before:rounded-b-full before:bg-chelth-teal"
                      : "text-slate-500 hover:text-chelth-navy",
                  )}
                >
                  <NavIcon name={item.icon} />
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              aria-controls={sheetId}
              onClick={() => setMoreOpen(true)}
              className="flex min-h-16 w-full flex-col items-center justify-center gap-1 px-2 text-[12px] font-medium text-slate-500 hover:text-chelth-navy"
            >
              <NavIcon name="more" />
              More
            </button>
          </li>
        </ul>
      </nav>

      <dialog
        ref={sheetRef}
        id={sheetId}
        aria-labelledby={titleId}
        onClose={() => setMoreOpen(false)}
        className="m-0 mx-auto mt-auto w-full max-w-xl rounded-t-xl border-0 bg-surface p-0 text-foreground shadow-elevated backdrop:bg-chelth-ink/40"
      >
        <div className="flex flex-col gap-2 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="font-display text-lg font-semibold text-chelth-navy">
              More
            </h2>
            <button
              type="button"
              onClick={() => setMoreOpen(false)}
              className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted"
            >
              <ShellGlyph name="close" />
              <span className="sr-only">Close menu</span>
            </button>
          </div>
          <p className="px-3 text-sm text-muted-foreground">
            {name}
            {user.displayName && user.email ? ` · ${user.email}` : ""}
          </p>
          <ul className="flex flex-col">
            <li>
              <Link
                href={homeHref as Route}
                className={sheetRow}
                onClick={() => setMoreOpen(false)}
              >
                {workspaceName} home
              </Link>
            </li>
            <li>
              <Link href="/app/account" className={sheetRow} onClick={() => setMoreOpen(false)}>
                Account
              </Link>
            </li>
            <li>
              <Link href="/app/security" className={sheetRow} onClick={() => setMoreOpen(false)}>
                Security
              </Link>
            </li>
          </ul>
          {otherWorkspaces.length > 0 ? (
            <div className="border-t border-border pt-2">
              <p
                id={switchId}
                className="px-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                Switch workspace
              </p>
              <ul aria-labelledby={switchId} className="flex flex-col">
                {otherWorkspaces.map((target) => (
                  <li key={target.id}>
                    <form action={selectWorkspaceAction} onSubmit={() => setMoreOpen(false)}>
                      <input type="hidden" name="organisationId" value={target.id} />
                      <button type="submit" className={sheetRow}>
                        <span className="min-w-0 flex-1 truncate">{target.name}</span>
                        <span className="text-xs text-muted-foreground">{target.typeLabel}</span>
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="border-t border-border pt-2">
            <Link href="/app" className={sheetRow} onClick={() => setMoreOpen(false)}>
              All workspaces
            </Link>
            <form action={signOutAction}>
              <button type="submit" className={sheetRow}>
                Sign out
              </button>
            </form>
          </div>
        </div>
      </dialog>
    </div>
  );
}
