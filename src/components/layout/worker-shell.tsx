"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

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
      strokeWidth={1.75}
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
 * Worker self-service shell (P7). Mobile-first: compact header, one content
 * column, bottom navigation of real worker destinations, and a "More" sheet
 * for workspace home, switching, Account, Security and Sign out. Never the
 * Agency sidebar; at wider widths it stays a centred column.
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
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="mx-auto flex min-h-14 w-full max-w-xl items-center gap-3 px-4">
          <Link href={homeHref as Route} className="shrink-0 rounded-sm">
            <BrandLogo variant="mark" height={28} />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-semibold text-chelth-navy">
              {workspaceName}
            </p>
            <p className="truncate text-xs text-muted-foreground">Worker · {name}</p>
          </div>
        </div>
      </header>

      <main id={MAIN_CONTENT_ID} className="flex-1 pt-6 pb-28">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4">{children}</div>
      </main>

      <nav
        aria-label="Worker"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
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
                    "relative flex min-h-16 flex-col items-center justify-center gap-0.5 px-2 text-xs font-medium",
                    current
                      ? "font-semibold text-primary before:absolute before:inset-x-4 before:top-0 before:h-0.5 before:rounded-full before:bg-primary"
                      : "text-muted-foreground hover:text-foreground",
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
              className="flex min-h-16 w-full flex-col items-center justify-center gap-0.5 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
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
