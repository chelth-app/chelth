import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { BrandLogo } from "@/components/shared/brand-logo";
import {
  ActivityTimeline,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTablePagination,
  DataTableRegion,
  DataTableRow,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterSelect,
  FormField,
  Input,
  KeyValueList,
  KpiFilterCard,
  KpiFilterGroup,
  LoadingState,
  PageHeader,
  SectionTabs,
  StatusChip,
  stateActionClass,
  SystemState,
  type StatusTone,
} from "@/components/ui";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { isProduction } from "@/config/env.public";

import { DialogDemo } from "./dialog-demo";

export const metadata: Metadata = { title: "Design system" };

/**
 * Internal reference for UI primitives. Not available in production.
 */
export default function DesignSystemPage() {
  if (isProduction) notFound();

  return (
    <main id={MAIN_CONTENT_ID} className="py-10">
      <PageContainer className="flex flex-col gap-10">
        <header className="flex flex-col gap-2">
          <BrandLogo />
          <h1 className="text-2xl font-semibold">Design system foundation</h1>
          <p className="text-sm text-muted-foreground">
            Internal reference. Not available in production.
          </p>
        </header>

        <section aria-labelledby="buttons-heading" className="flex flex-col gap-3">
          <h2 id="buttons-heading" className="text-lg font-semibold">
            Buttons
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button loading>Saving</Button>
            <Button disabled>Disabled</Button>
          </div>
        </section>

        <section aria-labelledby="badges-heading" className="flex flex-col gap-3">
          <h2 id="badges-heading" className="text-lg font-semibold">
            Badges
          </h2>
          <div className="flex flex-wrap gap-2">
            <Badge>Neutral</Badge>
            <Badge tone="brand">Brand</Badge>
            <Badge tone="info">Info</Badge>
            <Badge tone="success">Success</Badge>
            <Badge tone="warning">Warning</Badge>
            <Badge tone="danger">Danger</Badge>
          </div>
        </section>

        <section aria-labelledby="forms-heading" className="flex max-w-md flex-col gap-4">
          <h2 id="forms-heading" className="text-lg font-semibold">
            Form fields
          </h2>
          <FormField id="ds-email" label="Email address" description="We never share it." required>
            <Input type="email" autoComplete="email" />
          </FormField>
          <FormField id="ds-invalid" label="Reference" errors={["Enter a reference."]}>
            <Input />
          </FormField>
        </section>

        <section aria-labelledby="cards-heading" className="flex flex-col gap-3">
          <h2 id="cards-heading" className="text-lg font-semibold">
            Card and dialog
          </h2>
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle>Card title</CardTitle>
              <CardDescription>Supporting description text.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm">Card body content.</p>
            </CardContent>
            <CardFooter>
              <DialogDemo />
            </CardFooter>
          </Card>
        </section>

        <section aria-labelledby="operational-heading" className="flex flex-col gap-6">
          <h2 id="operational-heading" className="text-lg font-semibold">
            Operational primitives (P0-E8-S2)
          </h2>
          <div className="rounded-lg border border-border bg-background p-4">
            <PageHeader
              title="Page title"
              titleId="ds-page-title"
              description="One supporting sentence under a Manrope 32/40 title."
              back={<span className="text-muted-foreground">Breadcrumb slot</span>}
              primaryAction={<Button>Primary action</Button>}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {(["neutral", "info", "success", "warning", "danger", "attention"] as StatusTone[]).map(
              (tone) => (
                <StatusChip key={tone} tone={tone}>
                  {tone.charAt(0).toUpperCase() + tone.slice(1)}
                </StatusChip>
              ),
            )}
          </div>
          <KpiFilterGroup label="Example summary">
            <KpiFilterCard
              label="Needs review"
              value={3}
              supporting="2 urgent"
              href="/design-system"
              active
            />
            <KpiFilterCard label="Scheduled" value={12} supporting="Today" href="/design-system" />
            <KpiFilterCard label="Static figure" value={4} supporting="Not a link" />
          </KpiFilterGroup>
          <SectionTabs
            label="Example tabs"
            tabs={[
              { label: "Current view", href: "/design-system", current: true, count: 4 },
              { label: "Other view", href: "/", current: false },
            ]}
          />
          <FilterBar label="Example filters" resetHref="/design-system">
            <FilterSelect label="Status" id="ds-filter-status" name="status" defaultValue="">
              <option value="">All statuses</option>
              <option value="open">Open</option>
            </FilterSelect>
          </FilterBar>
          <DataTableRegion aria-label="Example table">
            <DataTable className="min-w-[36rem]">
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Worker</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell numeric>Hours</DataTableHeaderCell>
                  <DataTableHeaderCell>
                    <span className="sr-only">Details</span>
                  </DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                <DataTableRow selected>
                  <DataTableCell className="font-medium">Example worker</DataTableCell>
                  <DataTableCell>
                    <StatusChip tone="attention">Needs review</StatusChip>
                  </DataTableCell>
                  <DataTableCell numeric>8.0</DataTableCell>
                  <DataTableCell>
                    <DetailDrawerTrigger
                      triggerLabel="Details"
                      triggerAccessibleLabel="Details for Example worker"
                      title="Example worker"
                      description="Drawer for quick inspection; the record keeps its own page."
                      footer={<Button className="w-full">Primary action</Button>}
                    >
                      <KeyValueList
                        items={[
                          {
                            label: "Status",
                            value: <StatusChip tone="attention">Needs review</StatusChip>,
                          },
                          { label: "Hours", value: "8.0" },
                        ]}
                      />
                      <ActivityTimeline
                        label="Example activity"
                        items={[
                          { id: "a", title: "Clocked in", meta: "09:02", tone: "success" },
                          {
                            id: "b",
                            title: "Late clock-in recorded",
                            meta: "09:02",
                            tone: "attention",
                          },
                        ]}
                      />
                    </DetailDrawerTrigger>
                  </DataTableCell>
                </DataTableRow>
              </tbody>
            </DataTable>
          </DataTableRegion>
          <DataTablePagination
            label="Example pages"
            summary="Showing 1 row"
            nextHref="/design-system"
          />
          <EmptyState
            headingLevel={3}
            title="Nothing here yet"
            description="One sentence that explains what will appear and why."
            action={<Button variant="outline">One recovery action</Button>}
          />
        </section>

        <section aria-labelledby="system-states-heading" className="flex flex-col gap-3">
          <h2 id="system-states-heading" className="text-lg font-semibold">
            System states (P0-E8-S7)
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <SystemState
              headingLevel={2}
              title="Page not found"
              description="This page does not exist, or it is not available to you."
              action={
                <a href="/design-system" className={stateActionClass}>
                  Back to your workspaces
                </a>
              }
            />
            <SystemState
              headingLevel={2}
              tone="error"
              title="This page could not be loaded"
              description="Something went wrong. Please try again."
              reference="ref-123"
              action={<Button>Try again</Button>}
            />
          </div>
        </section>

        <section aria-labelledby="states-heading" className="flex flex-col gap-3">
          <h2 id="states-heading" className="text-lg font-semibold">
            States
          </h2>
          <Card>
            <LoadingState label="Loading example…" />
          </Card>
          <ErrorState message="This is a safe, user-facing error message." reference="ref-123" />
        </section>
      </PageContainer>
    </main>
  );
}
