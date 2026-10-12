import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DataTableRegion } from "@/components/ui/data-table";
import { FormField } from "@/components/ui/form-field";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import {
  CustomerAccountForm,
  getPlatformCustomer,
  LifecycleForm,
  LinkFacilityForm,
  listAgencyFacilityRecords,
  listPlatformCustomers,
  listSubscriptionPlans,
  PlatformInviteActions,
} from "@/features/platform";
import { organisationIdSchema } from "@/features/organisations";

import {
  AccountStatusChip,
  OrganisationStatusChip,
  PLATFORM_TABLE,
  platformDate,
  platformDateTime,
} from "../../_components/platform-ui";

export const metadata: Metadata = { title: "Organization" };

const EVENT_LABELS: Record<string, string> = {
  "organisation.created": "Organization created",
  "organisation.status_changed": "Organization status changed",
  "facility.linked": "Facility linked",
  "platform.customer_account_created": "Commercial account set up",
  "platform.plan_changed": "Plan changed",
  "platform.trial_changed": "Trial changed",
  "platform.subscription_changed": "Subscription changed",
  "platform.billing_contact_changed": "Billing contact changed",
  "invite.created": "Invitation created",
  "invite.resent": "Invitation resent",
  "invite.revoked": "Invitation revoked",
  "invite.accepted": "Invitation accepted",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[13px] text-slate-600">{label}</dt>
      <dd className="font-medium text-chelth-navy">{children}</dd>
    </div>
  );
}

/**
 * Platform organisation detail (P0-E9-4A): identity, commercial account,
 * provisioning, facility links, lifecycle and recent platform events — safe
 * metadata only. No payroll, rates, invoices, messages, documents, locations
 * or worker contact data, and no tenant actions.
 */
export default async function PlatformOrganisationPage({
  params,
  searchParams,
}: PageProps<"/platform/organisations/[organisationId]">) {
  const parsed = organisationIdSchema.safeParse((await params).organisationId);
  if (!parsed.success) notFound();
  const customer = await getPlatformCustomer(parsed.data);
  if (!customer) notFound();
  const { identity, account, provisioning, links, invites, system, events } = customer;
  const isAgency = identity.type === "agency";
  const base = `/platform/organisations/${identity.id}`;

  const query = await searchParams;
  const justLinked =
    typeof query.linked === "string"
      ? links.find(
          (link) => link.agency_facility_id === query.linked && link.facility_organisation_id,
        )
      : undefined;
  const rawAgency = query.agency;
  const chosenAgency =
    !isAgency && typeof rawAgency === "string" && organisationIdSchema.safeParse(rawAgency).success
      ? rawAgency
      : null;
  const [plans, agencies, records] = await Promise.all([
    isAgency ? listSubscriptionPlans() : Promise.resolve([]),
    isAgency
      ? Promise.resolve([])
      : listPlatformCustomers().then((all) =>
          all.filter((candidate) => candidate.type === "agency" && candidate.status === "active"),
        ),
    chosenAgency ? listAgencyFacilityRecords(chosenAgency) : Promise.resolve([]),
  ]);
  const chosenAgencyName = agencies.find((agency) => agency.id === chosenAgency)?.name ?? null;
  const unlinkedRecords = records.filter((record) => record.linkedOrganisationId === null);
  const accountSuspended = account?.status === "suspended";

  return (
    <>
      <PageHeader
        variant="reference"
        title={identity.name}
        back={
          <Link
            href="/platform/organisations"
            className="text-primary underline underline-offset-4"
          >
            Organizations
          </Link>
        }
        meta={
          <>
            <StatusChip tone="info">{isAgency ? "Agency" : "Facility organization"}</StatusChip>
            <OrganisationStatusChip status={identity.status} />
            {isAgency ? <AccountStatusChip status={account?.status ?? null} /> : null}
          </>
        }
      />

      <Panel titleId="identity-heading" title={<>Identity</>} variant="reference">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Field label="Slug">{identity.slug}</Field>
          <Field label="Language">{identity.locale ?? "Not set (English, United States)"}</Field>
          <Field label="Currency">{identity.default_currency ?? "Not set"}</Field>
          <Field label="Created">{platformDate(identity.created_at)}</Field>
          <Field label="Active members">{provisioning.active_members}</Field>
          <Field label="Seats (staff)">{provisioning.staff_seats}</Field>
          {isAgency ? (
            <>
              <Field label="Workers">{provisioning.workers}</Field>
              <Field label="Facility records">{provisioning.facility_records}</Field>
            </>
          ) : null}
        </dl>
      </Panel>

      {isAgency ? (
        <Panel
          titleId="commercial-heading"
          title={<>Commercial account</>}
          description={
            <>
              Chelth&apos;s own billing relationship with this agency. Manually managed: no payment
              provider is connected. Separate from the agency&apos;s own rates, payroll and
              invoices.
            </>
          }
          variant="reference"
        >
          {account ? (
            <dl className="mb-4 grid gap-4 sm:grid-cols-3">
              <Field label="Plan">{account.plan_name ?? "No plan yet"}</Field>
              <Field label="Billing contact">
                {account.billing_name ?? "—"}
                {account.billing_email ? (
                  <span className="block font-normal text-slate-600">{account.billing_email}</span>
                ) : null}
              </Field>
              <Field label="Provider">Manual (not connected)</Field>
              <Field label="Trial ends">{platformDate(account.trial_ends_on)}</Field>
              <Field label="Current period ends">
                {platformDate(account.current_period_ends_on)}
              </Field>
              <Field label="Cancel at period end">
                {account.cancel_at_period_end ? "Yes" : "No"}
              </Field>
            </dl>
          ) : (
            <p className="mb-4 text-sm text-slate-700">
              Commercial setup required. No plan or status is assumed for this agency until you set
              it up.
            </p>
          )}
          <CustomerAccountForm
            organisationId={identity.id}
            plans={plans.filter(
              (plan) => plan.status === "active" || plan.key === account?.plan_key,
            )}
            account={
              account
                ? {
                    status: account.status,
                    planKey: account.plan_key,
                    billingName: account.billing_name,
                    billingEmail: account.billing_email,
                    trialEndsOn: account.trial_ends_on,
                    currentPeriodEndsOn: account.current_period_ends_on,
                    cancelAtPeriodEnd: account.cancel_at_period_end,
                  }
                : null
            }
          />
        </Panel>
      ) : null}

      <Panel
        titleId="invites-heading"
        title={<>Owner invitations</>}
        description={
          <>Invitations issued from the platform. The invited owner joins; you never do.</>
        }
        variant="reference"
      >
        {invites.length === 0 ? (
          <p className="text-sm text-slate-700">No platform-issued invitations.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {invites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <span className="flex flex-col">
                  <span className="font-medium text-chelth-navy">{invite.email}</span>
                  <span className="text-slate-600">
                    Sent {invite.send_count}× · expires {platformDate(invite.expires_at)} · email{" "}
                    {invite.delivery_status ?? "not attempted"}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-2">
                  <StatusChip
                    tone={
                      invite.status === "accepted"
                        ? "success"
                        : invite.status === "revoked" || invite.expired
                          ? "neutral"
                          : "info"
                    }
                  >
                    {invite.status === "pending"
                      ? invite.expired
                        ? "Expired"
                        : "Pending"
                      : invite.status === "accepted"
                        ? "Accepted"
                        : "Revoked"}
                  </StatusChip>
                  {invite.status === "pending" ? (
                    <PlatformInviteActions
                      organisationId={identity.id}
                      inviteId={invite.id}
                      email={invite.email}
                    />
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        titleId="links-heading"
        title={<>Facility links</>}
        description={
          <>
            An agency&apos;s facility record linked to a facility organization lets that facility
            use Chelth with the agency. Links are explicit; nothing is matched automatically.
          </>
        }
        variant="reference"
      >
        {justLinked ? (
          <p
            role="status"
            className="mb-3 rounded-md bg-success-soft p-3 text-sm text-success-soft-foreground"
          >
            Facility linked: {justLinked.agency_name} · {justLinked.facility_record_name} ↔{" "}
            {justLinked.facility_organisation_name}.
          </p>
        ) : null}
        {links.length === 0 ? (
          <p className="text-sm text-slate-700">
            {isAgency ? "No facility records yet." : "Not linked to any agency facility yet."}
          </p>
        ) : (
          <DataTableRegion aria-label="Facility links table">
            <table className={PLATFORM_TABLE}>
              <caption className="sr-only">Facility links</caption>
              <thead>
                <tr>
                  <th scope="col">Agency</th>
                  <th scope="col">Agency facility record</th>
                  <th scope="col">Facility organization</th>
                  <th scope="col">Relationship</th>
                </tr>
              </thead>
              <tbody>
                {links.map((link) => (
                  <tr key={link.agency_facility_id}>
                    <td>{link.agency_name}</td>
                    <td>
                      {link.facility_record_name}
                      <span className="block text-[12.5px] text-slate-600">{link.timezone}</span>
                    </td>
                    <td>{link.facility_organisation_name ?? "Not linked"}</td>
                    <td>{link.relationship_status ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTableRegion>
        )}
        {!isAgency && identity.status === "active" ? (
          <div className="mt-5 flex flex-col gap-4 border-t border-border pt-4">
            <h3 className="text-[15px] font-semibold text-chelth-navy">Link an agency facility</h3>
            <form method="get" action={base as Route} className="flex flex-wrap items-end gap-2">
              <FormField id="link-agency" label="Agency" className="min-w-64">
                <Select name="agency" defaultValue={chosenAgency ?? ""}>
                  <option value="" disabled>
                    Choose an agency
                  </option>
                  {agencies.map((agency) => (
                    <option key={agency.id} value={agency.id}>
                      {agency.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <button
                type="submit"
                className="inline-flex h-11 items-center rounded-md border border-input-border bg-white px-4 text-sm font-medium text-chelth-navy hover:bg-surface-muted"
              >
                Show facility records
              </button>
            </form>
            {chosenAgency && chosenAgencyName ? (
              unlinkedRecords.length === 0 ? (
                <p className="text-sm text-slate-700">
                  {chosenAgencyName} has no unlinked facility records.
                </p>
              ) : (
                <LinkFacilityForm
                  facilityOrganisationId={identity.id}
                  agencyName={chosenAgencyName}
                  records={unlinkedRecords}
                />
              )
            ) : null}
          </div>
        ) : null}
      </Panel>

      <Panel
        titleId="lifecycle-heading"
        title={<>Organization access</>}
        description={
          <>
            Suspension stops access for every member and keeps all data. Reactivation restores the
            same organization.
          </>
        }
        variant="reference"
      >
        {accountSuspended ? (
          <p className="text-sm text-slate-700">
            Suspended through the commercial account. Change the account status to restore access.
          </p>
        ) : (
          <LifecycleForm
            organisationId={identity.id}
            organisationName={identity.name}
            currentStatus={identity.status}
          />
        )}
      </Panel>

      <Panel titleId="system-heading" title={<>System</>} variant="reference">
        <dl className="mb-4 grid gap-4 sm:grid-cols-2">
          <Field label="Failed notifications (30 days)">{system.notifications_failed_30d}</Field>
          <Field label="Document scans stuck">{system.scans_stuck}</Field>
        </dl>
        {events.length === 0 ? (
          <p className="text-sm text-slate-700">No platform events yet.</p>
        ) : (
          <ul
            aria-label="Recent platform events"
            className="flex flex-col divide-y divide-border text-sm"
          >
            {events.map((event, index) => (
              <li
                key={`${event.occurred_at}-${index}`}
                className="flex flex-wrap justify-between gap-2 py-2"
              >
                <span>{EVENT_LABELS[event.action] ?? event.action}</span>
                <span className="text-slate-600">{platformDateTime(event.occurred_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
