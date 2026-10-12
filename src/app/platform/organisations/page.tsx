import type { Metadata, Route } from "next";
import Link from "next/link";

import { DataTableRegion } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SectionTabs } from "@/components/ui/section-tabs";
import { CreatePlatformOrganisationForm, listPlatformCustomers } from "@/features/platform";

import {
  AccountStatusChip,
  OrganisationStatusChip,
  PLATFORM_TABLE,
  platformDate,
} from "../_components/platform-ui";

export const metadata: Metadata = { title: "Organizations" };

const FILTERS = {
  all: "All",
  agency: "Agencies",
  facility: "Facility organizations",
  suspended: "Suspended",
  setup: "Commercial setup required",
  trial: "On trial",
} as const;
type Filter = keyof typeof FILTERS;

/**
 * Organisation directory (P0-E9-4A): every agency and facility organisation
 * with safe metadata only — status, commercial state, plan, seats and facility
 * links. The platform admin is not a member of any of them.
 */
export default async function PlatformOrganisationsPage({
  searchParams,
}: PageProps<"/platform/organisations">) {
  const raw = (await searchParams).filter;
  const filter: Filter = typeof raw === "string" && raw in FILTERS ? (raw as Filter) : "all";
  const customers = await listPlatformCustomers();
  const shown = customers.filter((customer) => {
    switch (filter) {
      case "agency":
      case "facility":
        return customer.type === filter;
      case "suspended":
        return customer.status === "suspended";
      case "setup":
        return customer.type === "agency" && customer.accountStatus === null;
      case "trial":
        return customer.accountStatus === "trial";
      default:
        return true;
    }
  });

  return (
    <>
      <PageHeader
        variant="reference"
        title="Organizations"
        description={<p>Agencies and facility organizations using Chelth.</p>}
      />
      <SectionTabs
        label="Filter organizations"
        tabs={(Object.keys(FILTERS) as Filter[]).map((key) => ({
          label: FILTERS[key],
          href: (key === "all"
            ? "/platform/organisations"
            : `/platform/organisations?filter=${key}`) as Route,
          current: key === filter,
          count: customers.filter((customer) =>
            key === "all"
              ? true
              : key === "agency" || key === "facility"
                ? customer.type === key
                : key === "suspended"
                  ? customer.status === "suspended"
                  : key === "setup"
                    ? customer.type === "agency" && customer.accountStatus === null
                    : customer.accountStatus === "trial",
          ).length,
        }))}
      />
      <Panel titleId="directory-heading" title={<>{FILTERS[filter]}</>} variant="reference">
        {shown.length === 0 ? (
          <EmptyState headingLevel={3} title="No organizations match this filter." />
        ) : (
          <DataTableRegion aria-label="Organizations table">
            <table className={PLATFORM_TABLE}>
              <caption className="sr-only">Organizations</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                  <th scope="col">Commercial</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Seats</th>
                  <th scope="col">Facility links</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <Link
                        href={`/platform/organisations/${customer.id}` as Route}
                        className="font-medium text-chelth-navy underline-offset-4 hover:text-primary hover:underline"
                      >
                        {customer.name}
                      </Link>
                      {customer.ownerInvitePending ? (
                        <span className="block text-[12.5px] text-slate-600">
                          Owner invitation pending
                        </span>
                      ) : null}
                    </td>
                    <td>{customer.type === "agency" ? "Agency" : "Facility"}</td>
                    <td>
                      <OrganisationStatusChip status={customer.status} />
                    </td>
                    <td>{platformDate(customer.createdAt)}</td>
                    <td>
                      {customer.type === "agency" ? (
                        <AccountStatusChip status={customer.accountStatus} />
                      ) : (
                        <span className="text-slate-600">Not billed</span>
                      )}
                    </td>
                    <td>{customer.planName ?? "—"}</td>
                    <td className="tabular-nums">{customer.staffSeats}</td>
                    <td className="tabular-nums">
                      {customer.type === "agency"
                        ? `${customer.linkedFacilities} of ${customer.facilityRecords ?? 0}`
                        : customer.linkedFacilities}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTableRegion>
        )}
        <p className="mt-3 text-[12.5px] text-slate-600">
          Seats: active staff members (healthcare workers are not seats). Facility links: an
          agency&apos;s facility records linked to a facility organization.
        </p>
      </Panel>
      <Panel
        id="create"
        titleId="create-heading"
        title={<>Create an organization</>}
        description={
          <>
            Facility organizations are created here. Agencies can also sign up themselves. The owner
            is invited; you never become a member.
          </>
        }
        variant="reference"
      >
        <CreatePlatformOrganisationForm />
      </Panel>
    </>
  );
}
