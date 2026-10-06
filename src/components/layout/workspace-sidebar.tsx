"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
 * One workspace destination (locked P1): icon + label rows; the current page
 * is a lighter-teal pill with a fine border (a visible shape, not colour
 * alone) and `aria-current="page"`.
 */
export function SidebarNavItem({ item, active, onNavigate }: SidebarNavItemProps) {
  return (
    <li>
      <Link
        href={item.href as Route}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        className={cn(
          "flex min-h-[45px] items-center gap-[17px] rounded-lg border px-3.5 text-[15px] font-medium tracking-[-0.01em] text-shell-sidebar-foreground transition-colors",
          "focus-visible:outline-shell-sidebar-focus",
          active
            ? "border-white/35 bg-[linear-gradient(180deg,#007079,#005c63)] shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_0_0_1px_rgba(42,204,168,0.12),0_4px_14px_rgba(0,0,0,0.32)]"
            : "border-transparent hover:bg-shell-sidebar-hover",
        )}
      >
        <WorkspaceNavIcon name={item.icon} className="size-[22px]" />
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

  return (
    <div
      className={cn(
        "relative isolate flex h-full flex-col overflow-hidden bg-linear-to-b from-shell-sidebar from-40% to-shell-sidebar-deep text-shell-sidebar-foreground",
        className,
      )}
    >
      <SidebarWave />
      <div className="px-[22px] pt-[21px] pb-[17px]">
        {/* Canonical reverse lockup (public/brand/chelth/logo-reverse.svg), as supplied. */}
        <BrandLogo variant="reverse" height={56} />
      </div>
      <nav aria-label="Workspace" className="flex-1 overflow-y-auto pr-[13px] pb-8 pl-2.5">
        {/* Locked P1: one flat list (groups stay separate lists for screen readers). */}
        <div className="flex flex-col gap-[7px]">
          {groups.map((group) => (
            <ul key={group.label} aria-label={group.label} className="flex flex-col gap-[7px]">
              {group.items.map((item) => (
                <SidebarNavItem
                  key={item.href}
                  item={item}
                  active={isNavItemActive(item, pathname)}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          ))}
        </div>
      </nav>
    </div>
  );
}

/**
 * Locked P1 sidebar foot, reproduced from the approved reference: the lower
 * ~420 px brighten from the deep sidebar tone through teal to mint (brighter
 * on the right), a saturated teal band rises on the left, and two fine white
 * wave lines cross it. Decorative SVG, anchored to the bottom, clipped by the
 * sidebar, behind the navigation, no pointer events.
 */
function SidebarWave() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 214 420"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[420px] w-full"
    >
      <defs>
        <linearGradient id="sidebar-foot-depth" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#00363f" stopOpacity="0" />
          <stop offset="0.17" stopColor="#02464f" />
          <stop offset="0.36" stopColor="#0f6f72" />
          <stop offset="0.55" stopColor="#2aa39a" />
          <stop offset="0.74" stopColor="#7fd4c6" />
          <stop offset="1" stopColor="#b4ecdf" />
        </linearGradient>
        <linearGradient id="sidebar-foot-light" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#003a42" stopOpacity="0.28" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#e6f8f3" stopOpacity="0.42" />
        </linearGradient>
        <linearGradient id="sidebar-foot-band" x1="0" y1="0" x2="1" y2="0.25">
          <stop offset="0" stopColor="#0aa596" stopOpacity="0.95" />
          <stop offset="0.6" stopColor="#1fa197" stopOpacity="0.35" />
          <stop offset="1" stopColor="#5cbcb2" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="sidebar-foot-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.3" stopColor="white" stopOpacity="0" />
          <stop offset="0.75" stopColor="white" stopOpacity="1" />
        </linearGradient>
        <radialGradient id="sidebar-foot-glow">
          <stop offset="0" stopColor="#d4f8ee" stopOpacity="0.95" />
          <stop offset="0.6" stopColor="#a8e6d8" stopOpacity="0.3" />
          <stop offset="1" stopColor="#a8e6d8" stopOpacity="0" />
        </radialGradient>
        <mask id="sidebar-foot-mask" maskContentUnits="userSpaceOnUse">
          <rect width="214" height="420" fill="url(#sidebar-foot-fade)" />
        </mask>
      </defs>
      <rect width="214" height="420" fill="url(#sidebar-foot-depth)" />
      <rect
        width="214"
        height="420"
        fill="url(#sidebar-foot-light)"
        mask="url(#sidebar-foot-mask)"
      />
      <path
        d="M0 249C45 254 92 266 128 291C160 314 190 340 214 364V420H0Z"
        fill="url(#sidebar-foot-band)"
      />
      {/* Ambient mint light rising from the lower right. */}
      <ellipse cx="190" cy="430" rx="170" ry="150" fill="url(#sidebar-foot-glow)" />
      <path
        d="M0 211C28 216 55 226 84 254C112 281 140 309 168 334C185 350 200 366 214 379"
        fill="none"
        stroke="white"
        strokeOpacity="0.95"
        strokeWidth="2"
      />
      <path
        d="M0 314C35 319 66 327 97 340C128 353 162 371 214 391"
        fill="none"
        stroke="white"
        strokeOpacity="0.9"
        strokeWidth="2"
      />
    </svg>
  );
}
