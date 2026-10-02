import type { Route } from "next";
import Link from "next/link";
import type {
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";

import { cn } from "@/lib/utils/cn";

/*
 * Operational tables (P3 DataTable). Cell content stays page-specific: these
 * primitives only standardise the scroll region, density, header, row hover
 * and selection, and pagination.
 */

type RegionName =
  | { "aria-label": string; "aria-labelledby"?: never }
  | { "aria-labelledby": string; "aria-label"?: never };

export type DataTableRegionProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "role" | "tabIndex" | "aria-label" | "aria-labelledby"
> &
  RegionName;

/**
 * The ONE horizontal scroll container for wide tables.
 *
 * - `relative`: absolutely positioned descendants (e.g. `sr-only` header text)
 *   are contained by the region instead of escaping to the page, which
 *   caused page-level horizontal overflow on narrow viewports;
 * - `overflow-x-auto`: the table scrolls inside the region, never the page;
 * - `role="region"` + a required accessible name + `tabIndex={0}`: keyboard
 *   users can focus and scroll it (WCAG 2.1.1 / axe scrollable-region-focusable).
 */
export function DataTableRegion({ className, ...props }: DataTableRegionProps) {
  return (
    <div
      role="region"
      tabIndex={0}
      className={cn(
        "relative overflow-x-auto rounded-lg border border-border bg-surface",
        className,
      )}
      {...props}
    />
  );
}

export function DataTable({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full text-left text-sm", className)} {...props} />;
}

export function DataTableHead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "border-b border-border bg-surface-muted text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function DataTableHeaderCell({
  className,
  numeric = false,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn("px-3 py-2.5 font-medium", numeric && "text-right", className)}
      {...props}
    />
  );
}

export function DataTableRow({
  className,
  selected = false,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        "border-b border-border align-top transition-colors last:border-0 hover:bg-surface-muted/60",
        selected && "bg-chelth-mint-mist hover:bg-chelth-mint-mist",
        className,
      )}
      {...props}
    />
  );
}

export function DataTableCell({
  className,
  numeric = false,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td className={cn("px-3 py-2.5", numeric && "text-right tabular-nums", className)} {...props} />
  );
}

type DataTablePaginationProps = {
  /** Accessible name of the pagination landmark, e.g. "Shift list pages". */
  label: string;
  /** Optional summary such as "Showing 50 timesheets". */
  summary?: ReactNode;
  previousHref?: Route | null;
  previousLabel?: string;
  nextHref?: Route | null;
  nextLabel?: string;
  className?: string;
};

/**
 * Cursor pagination (the app pages by cursor, so there are no page numbers).
 * Renders nothing when there is neither a summary nor a link.
 */
export function DataTablePagination({
  label,
  summary,
  previousHref,
  previousLabel = "Previous page",
  nextHref,
  nextLabel = "Next page",
  className,
}: DataTablePaginationProps) {
  if (!summary && !previousHref && !nextHref) return null;
  const linkClass =
    "inline-flex min-h-11 items-center rounded-md border border-input-border bg-surface px-4 text-sm font-medium text-foreground hover:bg-surface-muted";
  return (
    <nav
      aria-label={label}
      className={cn("flex flex-wrap items-center justify-between gap-3", className)}
    >
      <p className="text-sm text-muted-foreground">{summary}</p>
      <div className="flex flex-wrap gap-2">
        {previousHref ? (
          <Link href={previousHref} className={linkClass}>
            {previousLabel}
          </Link>
        ) : null}
        {nextHref ? (
          <Link href={nextHref} className={linkClass}>
            {nextLabel}
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
