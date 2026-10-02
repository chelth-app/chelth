import type { Metadata, Route } from "next";
import Link from "next/link";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import type { WorkspaceNavIcon as WorkspaceNavIconName } from "@/components/layout/workspace-navigation-model";
import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterSelect } from "@/components/ui/filter-bar";
import { KeyValueList } from "@/components/ui/key-value-list";
import { KpiFilterCard, KpiFilterGroup } from "@/components/ui/kpi-filter-card";
import { PageHeader } from "@/components/ui/page-header";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { InviteWorkerForm, listWorkers, WorkerStatusBadge } from "@/features/workforce";
import { CAPABILITIES } from "@/lib/authz";
import { WORKER_STATUS_LABELS, WORKER_STATUSES, type WorkerStatus } from "@/lib/domain/vocabulary";

export const metadata: Metadata = { title: "Workforce" };

const STATUS_ICON: Record<"active" | "onboarding" | "suspended", WorkspaceNavIconName> = {
  active: "workforce",
  onboarding: "timesheets",
  suspended: "compliance",
};

export default async function WorkforcePage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/workforce">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.WORKER_VIEW);
  const { organisationId, organisation, can } = context;
  const workers =
    can(CAPABILITIES.WORKER_VIEW) === "granted" ? await listWorkers(organisationId) : [];
  const inviteState = can(CAPABILITIES.MEMBERSHIP_INVITE);
  // Display filter over the already-loaded list (no new query).
  const rawStatus = (await searchParams).status;
  const statusFilter = WORKER_STATUSES.find(
    (status) => status === (Array.isArray(rawStatus) ? rawStatus[0] : rawStatus),
  );
  const shown = statusFilter ? workers.filter((worker) => worker.status === statusFilter) : workers;
  const base = `/app/organisations/${organisationId}/workforce` as const;
  const countOf = (status: WorkerStatus) =>
    workers.filter((worker) => worker.status === status).length;

  return (
    <>
      <PageHeader
        title="Workforce"
        back={
          <Link
            href={`/app/organisations/${organisationId}`}
            className="text-primary underline underline-offset-4"
          >
            {organisation.name}
          </Link>
        }
        description={
          <p>
            Healthcare professionals working with {organisation.name}. Each person&apos;s record
            here is specific to this agency.
          </p>
        }
        primaryAction={
          inviteState === "granted" ? (
            <a
              href="#invite-worker-heading"
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              Invite worker
            </a>
          ) : undefined
        }
      />

      {workers.length > 0 ? (
        <KpiFilterGroup label="Workers by status">
          {(["active", "onboarding", "suspended"] as const).map((status) => (
            <KpiFilterCard
              key={status}
              label={WORKER_STATUS_LABELS[status]}
              value={countOf(status)}
              supporting={`of ${workers.length} workers`}
              icon={<WorkspaceNavIcon name={STATUS_ICON[status]} />}
              href={`${base}?status=${status}` as Route}
              active={statusFilter === status}
            />
          ))}
        </KpiFilterGroup>
      ) : null}

      {inviteState === "granted" ? (
        <section aria-labelledby="invite-worker-heading" className="flex flex-col gap-3">
          <h2 id="invite-worker-heading" className="scroll-mt-24 text-lg font-semibold">
            Invite a healthcare worker
          </h2>
          <InviteWorkerForm organisationId={organisationId} />
        </section>
      ) : inviteState === "step_up_required" ? (
        <StepUpNotice returnTo={`/app/organisations/${organisationId}/workforce`}>
          Inviting workers requires verification with your authenticator app.
        </StepUpNotice>
      ) : null}

      <section aria-labelledby="workers-heading" className="flex flex-col gap-3">
        <h2 id="workers-heading" className="text-lg font-semibold">
          Workers
        </h2>
        {workers.length > 0 ? (
          <FilterBar
            key={statusFilter ?? "all"}
            label="Filter workers"
            resetHref={statusFilter ? (base as Route) : undefined}
          >
            <FilterSelect
              label="Status"
              id="worker-status"
              name="status"
              defaultValue={statusFilter ?? ""}
            >
              <option value="">All statuses</option>
              {WORKER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {WORKER_STATUS_LABELS[status]}
                </option>
              ))}
            </FilterSelect>
          </FilterBar>
        ) : null}
        {workers.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No workers yet."
            description="Invited workers appear here once they accept."
          />
        ) : shown.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No workers with this status."
            action={
              <Link
                href={base}
                className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4"
              >
                Show all workers
              </Link>
            }
          />
        ) : (
          <DataTableRegion aria-label="Workers table">
            <DataTable className="min-w-[36rem]">
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Name</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Reference</DataTableHeaderCell>
                  <DataTableHeaderCell>Started</DataTableHeaderCell>
                  <DataTableHeaderCell>
                    <span className="sr-only">Details</span>
                  </DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                {shown.map((worker) => {
                  const name = worker.displayName ?? "Unnamed worker";
                  const href = `${base}/${worker.id}` as Route;
                  return (
                    <DataTableRow key={worker.id}>
                      <th scope="row" className="px-3 py-2.5 font-medium">
                        <Link href={href} className="text-primary underline underline-offset-4">
                          {name}
                        </Link>
                      </th>
                      <DataTableCell>
                        <WorkerStatusBadge status={worker.status} />
                      </DataTableCell>
                      <DataTableCell>{worker.workerReference ?? "—"}</DataTableCell>
                      <DataTableCell>{worker.startDate ?? "—"}</DataTableCell>
                      <DataTableCell>
                        <DetailDrawerTrigger
                          triggerLabel="Details"
                          triggerAccessibleLabel={`Details for ${name}`}
                          title={name}
                          description="Worker record at this agency"
                          footer={
                            <Link
                              href={href}
                              className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
                            >
                              Open worker record
                            </Link>
                          }
                        >
                          <KeyValueList
                            items={[
                              {
                                label: "Status",
                                value: <WorkerStatusBadge status={worker.status} />,
                              },
                              { label: "Reference", value: worker.workerReference ?? "—" },
                              { label: "Start date", value: worker.startDate ?? "Not started" },
                              { label: "End date", value: worker.endDate ?? "—" },
                            ]}
                          />
                          <p className="text-sm text-muted-foreground">
                            Readiness, credentials, disciplines and notes are on the worker record.
                          </p>
                        </DetailDrawerTrigger>
                      </DataTableCell>
                    </DataTableRow>
                  );
                })}
              </tbody>
            </DataTable>
          </DataTableRegion>
        )}
      </section>
    </>
  );
}
