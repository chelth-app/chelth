import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import {
  DisplayNameForm,
  getMyProfile,
  LocalePreference,
  TimezonePreference,
} from "@/features/identity";
import { spell } from "@/features/localization";
import {
  AdditionalBusinessForm,
  CreateOrganisationForm,
  getMyBusinessOwnership,
  listMyAdditionalBusinessRequests,
  WithdrawBusinessRequestForm,
} from "@/features/organisations";
import { requireAuthIdentity } from "@/lib/auth/session";

const REQUEST_STATUS: Record<string, string> = {
  pending: "Waiting for Chelth",
  fulfilled: "Set up",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const [identity, profile, ownership, requests] = await Promise.all([
    requireAuthIdentity(),
    getMyProfile(),
    getMyBusinessOwnership(),
    listMyAdditionalBusinessRequests(),
  ]);
  const ownsAgency = ownership.ownedAgencies > 0;
  return (
    // Purposeful width (P0-E8-A1.3): left-aligned 760 px column, locked panel.
    <div className="chelth-locked flex w-full max-w-[760px] flex-col gap-6">
      <PageHeader
        variant="reference"
        title="Account"
        description={<p>Signed in as {identity.email}</p>}
      />
      <Panel
        titleId="profile-details-heading"
        title={<>Profile details</>}
        description={<>Manage the name shown across Chelth.</>}
      >
        <DisplayNameForm displayName={profile.displayName ?? ""} />
      </Panel>
      <Panel
        titleId="timezone-heading"
        title={<>Timezone</>}
        description={<>Detected from this device unless you choose one.</>}
      >
        <TimezonePreference preferences={profile} />
      </Panel>
      <Panel
        titleId="language-heading"
        title={<>Language</>}
        description={<>Spelling used on your personal pages.</>}
      >
        <LocalePreference preferences={profile} />
      </Panel>
      {/* P0-E9-4A.2: one staffing business = one agency organisation. */}
      <Panel
        titleId="businesses-heading"
        title={<>Businesses</>}
        description={
          <>
            {spell(
              "Your staffing business on Chelth. Hospitals, nursing homes and clinics you serve are Facilities inside your agency workspace, not separate businesses.",
            )}
          </>
        }
      >
        {ownsAgency ? (
          <div className="flex flex-col gap-4 text-sm">
            <p className="text-slate-700">
              You own {ownership.ownedAgencies}{" "}
              {ownership.ownedAgencies === 1 ? "staffing business" : "staffing businesses"} on
              Chelth. Open {ownership.ownedAgencies === 1 ? "it" : "them"} from Organizations.
            </p>
            {requests.length > 0 ? (
              <ul
                aria-label="Additional business requests"
                className="flex flex-col divide-y divide-border"
              >
                {requests.map((request) => (
                  <li
                    key={request.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span className="flex flex-col">
                      <span className="font-medium text-chelth-navy">{request.businessName}</span>
                      <span className="text-slate-600">{REQUEST_STATUS[request.status]}</span>
                    </span>
                    {request.status === "pending" ? (
                      <WithdrawBusinessRequestForm
                        requestId={request.id}
                        businessName={request.businessName}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <details className="rounded-md border border-border p-3">
              <summary className="cursor-pointer font-medium text-primary">
                Add another business
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                <p className="text-slate-700">
                  Use this only if you operate a separate staffing business. Additional businesses
                  have separate Chelth subscriptions, teams and data. Branches and new facilities
                  belong inside your existing agency.
                </p>
                <AdditionalBusinessForm />
              </div>
            </details>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-slate-700">
              {spell(
                "You don't own a staffing business on Chelth yet. Create your staffing agency to manage your own workers, facilities and team.",
              )}
            </p>
            <details className="rounded-md border border-border p-3">
              <summary className="cursor-pointer font-medium text-primary">
                Create your staffing agency
              </summary>
              <div className="mt-3">
                <CreateOrganisationForm />
              </div>
            </details>
          </div>
        )}
      </Panel>
    </div>
  );
}
