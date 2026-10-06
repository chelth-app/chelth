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
  /**
   * `card` (default): labelled fields in a bordered container. `inline`: the
   * locked P3 Shifts filter row — one tight row of compact controls (labels
   * visually hidden but still programmatic), no container, actions at the end.
   */
  variant?: "card" | "inline";
};

/**
 * Filter row (P3 / P3-F): labelled controls above a native GET form, so
 * filters stay in the URL and work without JavaScript. Fields wrap on narrow
 * screens; there is no global search.
 *
 * Controls are uncontrolled (`defaultValue`). Give the bar a `key` derived
 * from the current filter values so it remounts when a link (e.g. a KPI quick
 * filter) changes the URL on the client; otherwise it would show stale values.
 */
export function FilterBar({
  label,
  children,
  submitLabel = "Apply filters",
  resetHref,
  resetLabel = "Clear filters",
  actions,
  variant = "card",
  className,
  method = "get",
  ...props
}: FilterBarProps) {
  if (variant === "inline") {
    return (
      <form
        aria-label={label}
        method={method}
        className={cn("flex flex-wrap items-center gap-2.5", className)}
        {...props}
      >
        {children}
        <Button type="submit" variant="outline" size="sm" className="min-h-11 sm:min-h-9">
          {submitLabel}
        </Button>
        {resetHref ? (
          <Link
            href={resetHref}
            className="inline-flex min-h-11 items-center px-1 text-[13px] font-medium text-primary underline underline-offset-4 sm:min-h-9"
          >
            {resetLabel}
          </Link>
        ) : null}
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{actions}</div>
        ) : null}
      </form>
    );
  }
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

/** Classes for a compact inline filter control (36 px desktop, 44 px touch, 16 px text on phones). */
export const inlineFilterControl =
  "h-11 w-auto min-w-36 rounded-md border border-input-border bg-surface px-3 text-base text-foreground sm:h-9 sm:text-[13px]";

/** Inline-variant select: label visually hidden, value text visible (e.g. "All facilities"). */
export function InlineFilterSelect({
  label,
  id,
  children,
  className,
  ...props
}: SelectProps & { label: string; id: string }) {
  return (
    <span className="flex flex-col">
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <select id={id} className={cn(inlineFilterControl, "pr-8", className)} {...props}>
        {children}
      </select>
    </span>
  );
}

/** Inline-variant date: a short visible prefix ("From") inside the control. */
export function InlineFilterDate({
  label,
  id,
  name,
  defaultValue,
}: {
  label: string;
  id: string;
  name: string;
  defaultValue?: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex h-11 items-center gap-2 rounded-md border border-input-border bg-surface pl-3 text-[13px] text-muted-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring sm:h-9"
    >
      {label}
      <input
        id={id}
        name={name}
        type="date"
        defaultValue={defaultValue}
        className="h-full rounded-r-md bg-transparent pr-2 text-base text-foreground outline-none sm:text-[13px]"
      />
    </label>
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
