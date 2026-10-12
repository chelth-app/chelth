"use client";

import type { Route } from "next";
import { usePathname } from "next/navigation";

import { SectionTabs } from "@/components/ui/section-tabs";

const SECTIONS = [
  { label: "Overview", href: "/platform", exact: true },
  { label: "Organizations", href: "/platform/organisations", exact: false },
  { label: "Billing", href: "/platform/billing", exact: false },
  { label: "System", href: "/platform/system", exact: false },
  { label: "Admins", href: "/platform/admins", exact: false },
  { label: "Activity", href: "/platform/activity", exact: false },
] as const;

/** Platform sections (P0-E9-4A). Not the tenant sidebar: a separate context. */
export function PlatformNav() {
  const pathname = usePathname();
  return (
    <SectionTabs
      label="Platform administration"
      tabs={SECTIONS.map((section) => ({
        label: section.label,
        href: section.href as Route,
        current: section.exact
          ? pathname === section.href
          : pathname === section.href || pathname.startsWith(`${section.href}/`),
      }))}
    />
  );
}
