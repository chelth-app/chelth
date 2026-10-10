/**
 * Shape of the workspace shell navigation. The items themselves are computed
 * on the server from the caller's capabilities
 * (`buildWorkspaceNavigation`, src/features/organisations); the shell only
 * renders what it is given.
 */
export type WorkspaceNavIcon =
  | "overview"
  | "operations"
  | "shifts"
  | "attendance"
  | "timesheets"
  | "workforce"
  | "facilities"
  | "compliance"
  | "rates"
  | "pricing"
  | "payroll"
  | "invoices"
  | "requests"
  | "messages"
  | "settings";

export type WorkspaceNavItem = {
  label: string;
  href: string;
  icon: WorkspaceNavIcon;
  /** `exact` for the Overview; `prefix` so detail pages keep their section active. */
  match: "exact" | "prefix";
  /**
   * Further route roots that keep this item current (prefix match), for an
   * item that stands for several route families (Finance: rates, pricing,
   * payroll, invoices).
   */
  activePaths?: readonly string[];
};

export type WorkspaceNavGroup = {
  /** Accessible name of the group's list; also shown as a small heading when `visibleLabel`. */
  label: string;
  visibleLabel: boolean;
  items: WorkspaceNavItem[];
};

/** True when `pathname` is the item's page or (for prefix items) one of its detail pages. */
export function isNavItemActive(item: WorkspaceNavItem, pathname: string): boolean {
  if (pathname === item.href) return true;
  if (item.match === "prefix" && pathname.startsWith(`${item.href}/`)) return true;
  return (item.activePaths ?? []).some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}
