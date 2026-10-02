import type { Metadata, Route } from "next";
import Link from "next/link";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
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
  FacilityForm,
  FacilityStatusBadge,
  listFacilities,
  listFacilityTypes,
  listTimezones,
} from "@/features/facilities";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";
import {
  FACILITY_STATUS_LABELS,
  FACILITY_STATUSES,
  type FacilityStatus,
} from "@/lib/domain/vocabulary";

export const metadata: Metadata = { title: "Facilities" };

export default async function FacilitiesPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/facilities">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.FACILITY_VIEW);
  const { organisationId, organisation, can } = context;
  const canManage = can(CAPABILITIES.FACILITY_MANAGE);
  const [facilities, facilityTypes] = await Promise.all([
    can(CAPABILITIES.FACILITY_VIEW) === "granted"
      ? listFacilities(organisationId)
      : Promise.resolve([]),
    listFacilityTypes(),
  ]);
  const typeName = new Map(facilityTypes.map((type) => [type.key, type.name]));
  // Display filter over the already-loaded list (no new query).
  const rawStatus = (await searchParams).status;
  const statusFilter = FACILITY_STATUSES.find(
    (status) => status === (Array.isArray(rawStatus) ? rawStatus[0] : rawStatus),
  );
  const shown = statusFilter
    ? facilities.filter((facility) => facility.status === statusFilter)
    : facilities;
  const base = `/app/organisations/${organisationId}/facilities` as const;
  const countOf = (status: FacilityStatus) =>
    facilities.filter((facility) => facility.status === status).length;

  return (
    <>
      <PageHeader
        title="Facilities"
        back={
          <Link
            href={`/app/organisations/${organisationId}`}
            className="text-primary underline underline-offset-4"
          >
            {organisation.name}
          </Link>
        }
        description={<p>Client facilities {organisation.name} works with.</p>}
        primaryAction={
          canManage === "granted" ? (
            <a
              href="#create-facility-heading"
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              Add facility
            </a>
          ) : undefined
        }
      />

      {facilities.length > 0 ? (
        <KpiFilterGroup label="Facilities by status">
          {FACILITY_STATUSES.map((status) => (
            <KpiFilterCard
              key={status}
              label={FACILITY_STATUS_LABELS[status]}
              value={countOf(status)}
              supporting={`of ${facilities.length} facilities`}
              icon={<WorkspaceNavIcon name="facilities" />}
              href={`${base}?status=${status}` as Route}
              active={statusFilter === status}
            />
          ))}
        </KpiFilterGroup>
      ) : null}

      <section aria-labelledby="facilities-heading" className="flex flex-col gap-3">
        <h2 id="facilities-heading" className="text-lg font-semibold">
          Client facilities
        </h2>
        {facilities.length > 0 ? (
          <FilterBar
            key={statusFilter ?? "all"}
            label="Filter facilities"
            resetHref={statusFilter ? (base as Route) : undefined}
          >
            <FilterSelect
              label="Status"
              id="facility-status"
              name="status"
              defaultValue={statusFilter ?? ""}
            >
              <option value="">All statuses</option>
              {FACILITY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {FACILITY_STATUS_LABELS[status]}
                </option>
              ))}
            </FilterSelect>
          </FilterBar>
        ) : null}
        {facilities.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No client facilities yet."
            description="Add the facilities you staff, then their locations and relationship."
          />
        ) : shown.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No facilities with this status."
            action={
              <Link
                href={base}
                className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4"
              >
                Show all facilities
              </Link>
            }
          />
        ) : (
          <DataTableRegion aria-label="Client facilities table">
            <DataTable className="min-w-[40rem]">
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Facility</DataTableHeaderCell>
                  <DataTableHeaderCell>Type</DataTableHeaderCell>
                  <DataTableHeaderCell>Locality</DataTableHeaderCell>
                  <DataTableHeaderCell>Timezone</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>
                    <span className="sr-only">Details</span>
                  </DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                {shown.map((facility) => {
                  const href = `${base}/${facility.id}` as Route;
                  const type = typeName.get(facility.facilityTypeKey) ?? facility.facilityTypeKey;
                  return (
                    <DataTableRow key={facility.id}>
                      <th scope="row" className="px-3 py-2.5 font-medium">
                        <Link href={href} className="text-primary underline underline-offset-4">
                          {facility.name}
                        </Link>
                      </th>
                      <DataTableCell>{type}</DataTableCell>
                      <DataTableCell>{facility.locality ?? "—"}</DataTableCell>
                      <DataTableCell>{facility.timezone}</DataTableCell>
                      <DataTableCell>
                        <FacilityStatusBadge status={facility.status} />
                      </DataTableCell>
                      <DataTableCell>
                        <DetailDrawerTrigger
                          triggerLabel="Details"
                          triggerAccessibleLabel={`Details for ${facility.name}`}
                          title={facility.name}
                          description={type}
                          footer={
                            <Link
                              href={href}
                              className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
                            >
                              Open facility
                            </Link>
                          }
                        >
                          <KeyValueList
                            items={[
                              {
                                label: "Status",
                                value: <FacilityStatusBadge status={facility.status} />,
                              },
                              { label: "Type", value: type },
                              { label: "Locality", value: facility.locality ?? "—" },
                              { label: "Timezone", value: facility.timezone },
                              {
                                label: "Chelth organisation",
                                value: facility.linked
                                  ? "Linked to a CHELTH facility organisation"
                                  : "Not linked",
                              },
                            ]}
                          />
                          <p className="text-sm text-muted-foreground">
                            Locations, relationship, location checks and credential requirements are
                            on the facility page.
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

      {canManage === "granted" ? (
        <section aria-labelledby="create-facility-heading" className="flex flex-col gap-3">
          <h2 id="create-facility-heading" className="scroll-mt-24 text-lg font-semibold">
            Add a client facility
          </h2>
          <FacilityForm
            organisationId={organisationId}
            facilityTypes={facilityTypes}
            timezones={listTimezones()}
          />
        </section>
      ) : canManage === "step_up_required" ? (
        <StepUpNotice returnTo={`/app/organisations/${organisationId}/facilities`}>
          Adding or editing facilities requires verification with your authenticator app.
        </StepUpNotice>
      ) : null}
    </>
  );
}
