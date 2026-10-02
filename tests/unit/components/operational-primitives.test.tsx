// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";

import { ActivityTimeline } from "@/components/ui/activity-timeline";
import { DataTableRegion, DataTablePagination, DataTableRow } from "@/components/ui/data-table";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterSelect } from "@/components/ui/filter-bar";
import { KeyValueList } from "@/components/ui/key-value-list";
import { KpiFilterCard } from "@/components/ui/kpi-filter-card";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTabs } from "@/components/ui/section-tabs";
import { StatusChip } from "@/components/ui/status-chip";

beforeAll(() => {
  // jsdom has <dialog> but no modal behaviour; the real focus trap, Escape and
  // focus return are verified in the browser (tests/e2e/operational-primitives.spec.ts).
  const proto = HTMLDialogElement.prototype;
  proto.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

describe("PageHeader", () => {
  it("renders one h1 in the display face with copy, back link and actions", () => {
    render(
      <PageHeader
        title="Pricing"
        description="Locked timesheets priced with the rates in force."
        back={<a href="/app">Back</a>}
        primaryAction={<button type="button">New rate</button>}
      />,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Pricing" });
    expect(heading).toHaveClass("font-display");
    expect(screen.getByText("Locked timesheets priced with the rates in force.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New rate" })).toBeInTheDocument();
  });

  it("omits the action area when there are no actions", () => {
    const { container } = render(<PageHeader title="Attendance" />);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("KpiFilterCard", () => {
  it("is a link whose name includes the value and label", () => {
    render(<KpiFilterCard label="Needs review" value={3} href="/app" />);
    expect(screen.getByRole("link", { name: /3\s*Needs review/ })).toHaveAttribute("href", "/app");
  });

  it("marks the active filter with aria-current and visible text, not colour alone", () => {
    render(<KpiFilterCard label="Needs review" value={3} href="/app" active />);
    const link = screen.getByRole("link", { name: /Needs review/ });
    expect(link).toHaveAttribute("aria-current", "true");
    expect(within(link).getByText("Showing")).toBeInTheDocument();
  });

  it("renders a static figure without an interactive role when it has no target", () => {
    render(<KpiFilterCard label="Scheduled" value={12} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });
});

describe("DataTableRegion", () => {
  it("is a named, focusable region that contains its overflow", () => {
    render(
      <DataTableRegion aria-label="Payroll lines">
        <table>
          <tbody>
            <tr>
              <td>Row</td>
            </tr>
          </tbody>
        </table>
      </DataTableRegion>,
    );
    const region = screen.getByRole("region", { name: "Payroll lines" });
    expect(region).toHaveAttribute("tabindex", "0");
    // `relative` keeps absolutely positioned (sr-only) descendants inside the
    // scroll container; `overflow-x-auto` keeps wide tables from widening the page.
    expect(region).toHaveClass("relative", "overflow-x-auto");
  });

  it("marks selected rows for assistive technology", () => {
    render(
      <table>
        <tbody>
          <DataTableRow selected>
            <td>Selected</td>
          </DataTableRow>
        </tbody>
      </table>,
    );
    expect(screen.getByRole("row")).toHaveAttribute("aria-selected", "true");
  });

  it("renders pagination as a labelled navigation landmark, or nothing", () => {
    const { rerender } = render(
      <DataTablePagination label="Pricing queue pages" nextHref="/app" />,
    );
    const nav = screen.getByRole("navigation", { name: "Pricing queue pages" });
    expect(within(nav).getByRole("link", { name: "Next page" })).toHaveAttribute("href", "/app");
    rerender(<DataTablePagination label="Pricing queue pages" nextHref={null} />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});

describe("StatusChip", () => {
  it.each(["neutral", "info", "success", "warning", "danger", "attention"] as const)(
    "carries its meaning in text for the %s tone",
    (tone) => {
      render(<StatusChip tone={tone}>Needs review</StatusChip>);
      const chip = screen.getByText("Needs review");
      expect(chip).toHaveClass(`bg-${tone}-soft`, `text-${tone}-soft-foreground`);
    },
  );
});

describe("DetailDrawer", () => {
  it("opens as a named dialog with a close control and closes again", async () => {
    render(
      <DetailDrawerTrigger
        triggerLabel="Details"
        triggerAccessibleLabel="Details for Leo Late"
        title="Leo Late"
        description="Mercy Rehab · Mon 5 Oct"
        footer={<a href="/app">Open attendance record</a>}
      >
        <KeyValueList items={[{ label: "Status", value: "Needs review" }]} />
      </DetailDrawerTrigger>,
    );
    const trigger = screen.getByRole("button", { name: "Details for Leo Late" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await userEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Leo Late" });
    expect(dialog).toHaveAttribute("open");
    expect(within(dialog).getByRole("link", { name: "Open attendance record" })).toBeVisible();
    expect(within(dialog).getByText("Needs review")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close details" }));
    expect(dialog).not.toHaveAttribute("open");
  });
});

describe("EmptyState", () => {
  it("shows a title, one sentence and one action, with a decorative icon", () => {
    const { container } = render(
      <EmptyState
        title="No blocked timesheets."
        description="Timesheets that cannot be priced appear here."
        action={<a href="/app/rates">Review rates</a>}
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "No blocked timesheets." })).toBeVisible();
    expect(screen.getByRole("link", { name: "Review rates" })).toBeInTheDocument();
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
  });

  it("can sit under a section heading", () => {
    render(<EmptyState headingLevel={3} title="No activity yet" />);
    expect(screen.getByRole("heading", { level: 3, name: "No activity yet" })).toBeVisible();
  });
});

describe("SectionTabs, FilterBar, KeyValueList, ActivityTimeline", () => {
  it("renders route tabs as links with aria-current, not ARIA tabs", () => {
    render(
      <SectionTabs
        label="Pricing queues"
        tabs={[
          { label: "Needs attention", href: "/app", current: true },
          { label: "Priced", href: "/app/account", current: false },
        ]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Pricing queues" });
    expect(within(nav).getByRole("link", { name: "Needs attention" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Priced" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("renders a named GET filter form with labelled native controls", () => {
    render(
      <FilterBar label="Filter shifts" resetHref="/app">
        <FilterSelect label="Status" id="status" name="status" defaultValue="">
          <option value="">All statuses</option>
        </FilterSelect>
      </FilterBar>,
    );
    const form = screen.getByRole("form", { name: "Filter shifts" });
    expect(form).toHaveAttribute("method", "get");
    expect(within(form).getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Apply filters" })).toHaveAttribute(
      "type",
      "submit",
    );
    expect(within(form).getByRole("link", { name: "Clear filters" })).toHaveAttribute(
      "href",
      "/app",
    );
  });

  it("renders key-value pairs as a description list and activity as an ordered list", () => {
    render(
      <>
        <KeyValueList aria-label="Totals" items={[{ label: "Pay", value: "$10.00" }]} />
        <ActivityTimeline
          label="Recent activity"
          items={[{ id: "1", title: "Member invited", meta: "by Ada" }]}
        />
      </>,
    );
    expect(screen.getByRole("term")).toHaveTextContent("Pay");
    expect(screen.getByRole("definition")).toHaveTextContent("$10.00");
    const list = screen.getByRole("list", { name: "Recent activity" });
    expect(list.tagName).toBe("OL");
    expect(within(list).getByRole("listitem")).toHaveTextContent("Member invited");
  });
});

describe("table regions (structural guard)", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return full.endsWith(".tsx") ? [full] : [];
    });
  }

  it("every horizontally scrolling table region uses DataTableRegion", () => {
    const offenders = sourceFiles(path.resolve(import.meta.dirname, "../../../src"))
      .filter((file) => !file.endsWith(path.join("components", "ui", "data-table.tsx")))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return /overflow-x-auto/.test(source) && /<table/.test(source);
      });
    expect(offenders).toEqual([]);
  });
});
