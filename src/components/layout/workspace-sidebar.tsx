"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";

import { BrandLogo } from "@/components/shared/brand-logo";
import { cn } from "@/lib/utils/cn";

import { WorkspaceNavIcon } from "./workspace-nav-icon";
import {
  isNavItemActive,
  type WorkspaceNavGroup,
  type WorkspaceNavItem,
} from "./workspace-navigation-model";

type SidebarNavItemProps = {
  item: WorkspaceNavItem;
  active: boolean;
  onNavigate?: () => void;
};

/**
 * One workspace destination. The current page is marked with
 * `aria-current="page"` and, visually, by more than colour: a filled pill, a
 * leading indicator bar and a heavier label.
 */
export function SidebarNavItem({ item, active, onNavigate }: SidebarNavItemProps) {
  return (
    <li>
      <Link
        href={item.href as Route}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        className={cn(
          "relative flex min-h-11 items-center gap-3 rounded-md px-3 text-sm text-shell-sidebar-foreground transition-colors",
          "focus-visible:outline-shell-sidebar-focus",
          active
            ? "bg-shell-sidebar-active font-semibold before:absolute before:inset-y-2.5 before:left-0 before:w-1 before:rounded-full before:bg-shell-sidebar-indicator"
            : "font-medium hover:bg-shell-sidebar-hover",
        )}
      >
        <WorkspaceNavIcon name={item.icon} className={active ? undefined : "opacity-90"} />
        <span className="truncate">{item.label}</span>
      </Link>
    </li>
  );
}

type WorkspaceSidebarProps = {
  groups: WorkspaceNavGroup[];
  /** Called after a destination is chosen (closes the narrow-viewport overlay). */
  onNavigate?: () => void;
  className?: string;
};

/** Canonical workspace sidebar: reverse logo on the dark teal shell surface. */
export function WorkspaceSidebar({ groups, onNavigate, className }: WorkspaceSidebarProps) {
  const pathname = usePathname();
  const idPrefix = useId();

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-linear-to-b from-shell-sidebar to-shell-sidebar-deep text-shell-sidebar-foreground",
        className,
      )}
    >
      <div className="px-5 pt-6 pb-5">
        <BrandLogo variant="reverse" height={48} />
      </div>
      <nav aria-label="Workspace" className="flex-1 overflow-y-auto px-3 pb-8">
        {groups.map((group, index) => {
          const headingId = `${idPrefix}-group-${index}`;
          return (
            <div key={group.label}>
              {index > 0 ? (
                <hr className="mx-3 my-3 border-t border-shell-sidebar-divider" />
              ) : null}
              {group.visibleLabel ? (
                <p
                  id={headingId}
                  className="px-3 pb-1.5 text-xs font-semibold tracking-wide text-shell-sidebar-muted uppercase"
                >
                  {group.label}
                </p>
              ) : null}
              <ul
                className="flex flex-col gap-1"
                {...(group.visibleLabel
                  ? { "aria-labelledby": headingId }
                  : { "aria-label": group.label })}
              >
                {group.items.map((item) => (
                  <SidebarNavItem
                    key={item.href}
                    item={item}
                    active={isNavItemActive(item, pathname)}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </div>
  );
}
