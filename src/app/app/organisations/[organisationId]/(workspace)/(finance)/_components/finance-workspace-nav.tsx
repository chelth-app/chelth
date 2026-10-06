"use client";

import type { Route } from "next";
import { usePathname } from "next/navigation";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { SectionTabs } from "@/components/ui/section-tabs";

/**
 * The one Finance workspace navigation (P0-E8-F2.5): a "Finance" label and the
 * finance areas the caller can open, in the locked order Rates · Pricing ·
 * Payroll · Invoices. Each tab is a link to an existing route; the area stays
 * current on its detail and adjustment pages. Rendered once by the (finance)
 * layout above every finance page. Locked tab treatment (SectionTabs): the
 * current area is a 3 px teal underline, 600 ink and aria-current; the others
 * 500 slate. It scrolls horizontally on phones without widening the page.
 */
export function FinanceWorkspaceNav({
  organisationId,
  areas,
}: {
  organisationId: string;
  areas: readonly { key: string; label: string }[];
}) {
  const pathname = usePathname();
  const base = `/app/organisations/${organisationId}`;
  return (
    // -mb-2: the shell sits 12 px above the page title (the workspace column gap is 20 px),
    // so the Finance row and the page heading read as one header.
    <div className="chelth-locked -mb-2 flex min-w-0 items-end gap-4 border-b border-[rgba(18,107,103,0.14)] sm:gap-6">
      <span
        aria-hidden="true"
        className="mb-3 inline-flex shrink-0 items-center gap-2 text-[12.5px] leading-5 font-bold tracking-[0.04em] text-slate-700 uppercase"
      >
        <WorkspaceNavIcon
          name="payroll"
          strokeWidth={2.1}
          className="size-[18px] text-chelth-teal-dark"
        />
        Finance
      </span>
      <SectionTabs
        label="Finance"
        // Keyboard focus ring drawn inside each tab: the scrolling row would otherwise clip an
        // outset ring to two vertical bars beside the tab.
        className="min-w-0 flex-1 border-b-0 in-[.chelth-locked]:border-b-0 [&_a]:rounded-t-[6px] [&_a:focus-visible]:outline-offset-[-3px]"
        tabs={areas.map((area) => {
          const href = `${base}/${area.key}`;
          return {
            label: area.label,
            href: href as Route,
            current: pathname === href || pathname.startsWith(`${href}/`),
          };
        })}
      />
    </div>
  );
}
