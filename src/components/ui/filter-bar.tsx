import type { Route } from "next";
import Link from "next/link";
import type { FormHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import { Button } from "./button";
import { Label } from "./label";
import { Select, type SelectProps } from "./select";

type FilterBarProps = Omit<FormHTMLAttributes<HTMLFormElement>, "children"> & {
  /** Accessible name of the filter form, e.g. "Filter shifts". */
  label: string;
  children: ReactNode;
  /** Text of the submit button (the existing wording is kept per page). */
  submitLabel?: string;
  /** Link that clears every filter (the unfiltered page). */
  resetHref?: Route;
  resetLabel?: string;
  /** Page actions shown at the end of the bar (e.g. Export). */
  actions?: ReactNode;
};

/**
 * Filter row (P3 / P3-F): labelled controls above a native GET form, so
 * filters stay in the URL and work without JavaScript. Fields wrap on narrow
 * screens; there is no global search.
 */
export function FilterBar({
  label,
  children,
  submitLabel = "Apply filters",
  resetHref,
  resetLabel = "Clear filters",
  actions,
  className,
  method = "get",
  ...props
}: FilterBarProps) {
  return (
    <form
      aria-label={label}
      method={method}
      className={cn(
        "flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3 sm:p-4",
        className,
      )}
      {...props}
    >
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="outline">
          {submitLabel}
        </Button>
        {resetHref ? (
          <Link
            href={resetHref}
            className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-primary underline underline-offset-4"
          >
            {resetLabel}
          </Link>
        ) : null}
      </div>
      {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
    </form>
  );
}

/** A labelled filter control: label above the control (P3-F). */
export function FilterField({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-40 flex-1 flex-col gap-1.5 sm:flex-none", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

/** Native select as a filter (keeps native keyboard and screen-reader behaviour). */
export function FilterSelect({
  label,
  id,
  children,
  ...props
}: SelectProps & { label: string; id: string }) {
  return (
    <FilterField label={label} htmlFor={id}>
      <Select id={id} {...props}>
        {children}
      </Select>
    </FilterField>
  );
}
