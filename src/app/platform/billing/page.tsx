import type { Metadata, Route } from "next";
import Link from "next/link";

import { DataTableRegion } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { LockedNotice } from "@/components/reference/locked-notice";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { listPlatformCustomers, listSubscriptionPlans, PlanForm } from "@/features/platform";

import { AccountStatusChip, PLATFORM_TABLE, platformDate } from "../_components/platform-ui";

export const metadata: Metadata = { title: "Billing" };

function money(minor: number | null, currency: string | null): string {
  if (minor === null || !currency) return "Not priced";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

/**
 * Chelth billing metadata (P0-E9-4A): Agency → Chelth only. Manually managed
 * — no payment provider is connected, so there is no charge or card action.
 * Tenant operational finance (rates, pricing, payroll, facility invoices) is
 * never shown here.
 */
export default async function PlatformBillingPage() {
  const [customers, plans] = await Promise.all([listPlatformCustomers(), listSubscriptionPlans()]);
  const agencies = customers.filter((customer) => customer.type === "agency");
  const today = new Date().toISOString().slice(0, 10);
  const attention = (customer: (typeof agencies)[number]): string | null => {
    if (customer.accountStatus === null) return "Set up the commercial account";
    if (customer.accountStatus === "past_due") return "Payment past due";
    if (customer.accountStatus === "trial" && customer.trialEndsOn && customer.trialEndsOn < today)
      return "Trial has ended";
    if (customer.accountStatus === "trial" && !customer.trialEndsOn) return "No trial end date";
    if (!customer.planKey) return "No plan assigned";
    return null;
  };

  return (
    <>
      <PageHeader
        variant="reference"
        title="Billing"
        description={
          <p>Chelth subscriptions for each agency. Agencies, not facilities, are billed.</p>
        }
      />
      <LockedNotice tone="info" title="Payment provider: not connected">
        Commercial accounts are managed by hand for the pilot. Statuses and dates here are records,
        not charges.
      </LockedNotice>
      <Panel titleId="accounts-heading" title={<>Agency accounts</>} variant="reference">
        {agencies.length === 0 ? (
          <EmptyState headingLevel={3} title="No agencies yet." />
        ) : (
          <DataTableRegion aria-label="Agency accounts table">
            <table className={PLATFORM_TABLE}>
              <caption className="sr-only">Agency accounts</caption>
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Subscription</th>
                  <th scope="col">Trial ends</th>
                  <th scope="col">Period ends</th>
                  <th scope="col">Seats</th>
                  <th scope="col">Facilities</th>
                  <th scope="col">Attention</th>
                </tr>
              </thead>
              <tbody>
                {agencies.map((customer) => {
                  const note = attention(customer);
                  return (
                    <tr key={customer.id}>
                      <td>
                        <Link
                          href={`/platform/organisations/${customer.id}` as Route}
                          className="font-medium text-chelth-navy underline-offset-4 hover:text-primary hover:underline"
                        >
                          {customer.name}
                        </Link>
                      </td>
                      <td>{customer.planName ?? "—"}</td>
                      <td>
                        <AccountStatusChip status={customer.accountStatus} />
                      </td>
                      <td>{platformDate(customer.trialEndsOn)}</td>
                      <td>{platformDate(customer.currentPeriodEndsOn)}</td>
                      <td className="tabular-nums">{customer.staffSeats}</td>
                      <td className="tabular-nums">{customer.facilityRecords ?? 0}</td>
                      <td>
                        {note ? (
                          <StatusChip tone="warning">{note}</StatusChip>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataTableRegion>
        )}
        <p className="mt-3 text-[12.5px] text-slate-600">
          Seats count active staff memberships (not healthcare workers). Facilities count the
          agency&apos;s facility records. Counts are shown only; no plan limits are enforced.
        </p>
      </Panel>
      <Panel titleId="plans-heading" title={<>Plans</>} variant="reference">
        <ul className="mb-5 flex flex-col divide-y divide-border text-sm">
          {plans.map((plan) => (
            <li key={plan.key} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="flex flex-col">
                <span className="font-medium text-chelth-navy">
                  {plan.name} <span className="font-normal text-slate-600">({plan.key})</span>
                </span>
                <span className="text-slate-600">
                  {money(plan.monthlyPriceMinor, plan.currency)} · seats{" "}
                  {plan.includedSeats ?? "not set"} · facilities{" "}
                  {plan.includedFacilities ?? "not set"} · {plan.accounts}{" "}
                  {plan.accounts === 1 ? "account" : "accounts"}
                </span>
              </span>
              <StatusChip tone={plan.status === "active" ? "success" : "neutral"}>
                {plan.status === "active" ? "Active" : "Retired"}
              </StatusChip>
            </li>
          ))}
        </ul>
        <h3 className="mb-2 text-[15px] font-semibold text-chelth-navy">Add or update a plan</h3>
        <PlanForm />
      </Panel>
    </>
  );
}
