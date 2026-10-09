import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { RefChip } from "@/components/reference/locked-reference";
import { Button } from "@/components/ui/button";
import { StateIcon } from "@/components/ui/state-icon";
import { getMyProfile } from "@/features/identity";
import { cn } from "@/lib/utils/cn";
import {
  CreateOrganisationForm,
  listMyMemberships,
  listRoles,
  readActiveOrganisationPreference,
  readPendingInviteToken,
  selectOrganisationAction,
  workerOnlyAgencies,
} from "@/features/organisations";

export const metadata: Metadata = { title: "Your organisations" };

const NOTICES: Record<string, string> = {
  "password-updated": "Your password has been updated.",
};

/** Readable role summary: one role by name; several joined; never a raw count. */
function roleSummary(names: string[]): string {
  if (names.length === 0) return "No active role";
  if (names.length <= 2) return names.join(" · ");
  return `${names.slice(0, 2).join(" · ")} +${names.length - 2} more`;
}

/**
 * Workspace chooser (locked system, P0-E8-A1.1): the signed-in app entry.
 * Real memberships only, as polished workspace cards (organisation, type,
 * readable role names, the existing "last used" preference, Open workspace).
 * The preference only reorders the list; nothing is opened automatically.
 * Creating an agency is a secondary setup surface with the existing form.
 */
export default async function AppHomePage({ searchParams }: PageProps<"/app">) {
  const [profile, memberships, preferredOrganisationId, pendingInvite, { notice }] =
    await Promise.all([
      getMyProfile(),
      listMyMemberships(),
      readActiveOrganisationPreference(),
      readPendingInviteToken(),
      searchParams,
    ]);
  const visible = memberships.filter((membership) => membership.organisation !== null);
  const noticeText = typeof notice === "string" ? NOTICES[notice] : undefined;

  // Worker-first entry (P0-E9-3B): a Healthcare-Worker-only account opens its
  // shifts. One agency → straight to My Shifts (unless a pending invitation or
  // a notice must be seen first); several → a worker-only agency chooser.
  // Staff, facility, mixed and new users keep the general gateway below.
  const workerAgencies = workerOnlyAgencies(visible);
  if (workerAgencies) {
    const [onlyAgency] = workerAgencies;
    if (workerAgencies.length === 1 && onlyAgency && !pendingInvite && !noticeText) {
      redirect(`/app/organisations/${onlyAgency.id}/my-shifts` as Route);
    }
    return (
      <WorkerAgencyChooser
        agencies={workerAgencies}
        displayName={profile.displayName}
        notice={noticeText}
        pendingInvite={Boolean(pendingInvite)}
      />
    );
  }

  // The preference only reorders the list; nothing is selected automatically.
  const ordered = [...visible].sort(
    (a, b) =>
      Number(b.organisation?.id === preferredOrganisationId) -
      Number(a.organisation?.id === preferredOrganisationId),
  );
  const types = [
    ...new Set(visible.flatMap(({ organisation }) => (organisation ? [organisation.type] : []))),
  ];
  const roleLists = await Promise.all(types.map((type) => listRoles(type)));
  const roleName = new Map(roleLists.flat().map((role) => [role.key, role.name]));
  return (
    // Gateway (P0-E8-A1.3, spacing A1.4): the welcome spans the top; from lg the primary
    // task (open a workspace) takes ~64% on the left and the secondary "Create a new agency"
    // panel ~36% on the right (24 px gap), aligned with "Your organisations"; below lg the
    // order stacks.
    <div className="flex flex-col gap-7">
      <PageHeader
        variant="reference"
        title={`Welcome${profile.displayName ? `, ${profile.displayName}` : ""}`}
        description={<p>Choose an organisation to continue.</p>}
      />

      {noticeText ? (
        <p
          role="status"
          className="rounded-[12px] border border-[rgba(18,107,103,0.12)] bg-[linear-gradient(180deg,#f6fbfa,#eef7f4)] px-4 py-3 text-sm font-medium text-chelth-navy"
        >
          {noticeText}
        </p>
      ) : null}

      {pendingInvite ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[rgba(47,116,240,0.14)] bg-info-soft/45 px-4 py-3 text-sm text-chelth-navy"
        >
          <span className="font-medium">You have a pending invitation.</span>
          <Link
            href="/invite"
            className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
          >
            Review invitation
          </Link>
        </div>
      ) : null}

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)] lg:items-start lg:gap-6">
        <div className="flex min-w-0 flex-col gap-7">
          <section aria-labelledby="organisations-heading" className="flex flex-col gap-3">
            <h2
              id="organisations-heading"
              className="font-display text-[20px] leading-[26px] font-semibold tracking-[-0.02em] text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]"
            >
              Your organisations
            </h2>
            {ordered.length === 0 ? (
              // Canonical system empty state: tile, short heading, one line; the real
              // action (create an agency) is the panel below.
              <div className="flex items-center gap-3 rounded-[14px] border border-[rgba(18,107,103,0.10)] bg-white p-4 shadow-[0_8px_24px_rgba(13,47,66,0.06),0_1px_2px_rgba(13,47,66,0.04)]">
                <StateIcon name="empty" />
                <div className="flex flex-col gap-0.5">
                  <h3 className="text-[15px] leading-5 font-semibold text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]">
                    You are not a member of any organisation yet.
                  </h3>
                  <p className="text-[13.5px] leading-5 text-slate-600">
                    Ask an administrator to invite you, or create an agency below.
                  </p>
                </div>
              </div>
            ) : (
              <ul
                aria-label="Your organisations"
                className={cn(
                  "grid gap-4 sm:grid-cols-2",
                  // Desktop (A1.4): a single workspace gets one comfortable card, not half the column.
                  ordered.length === 1 && "lg:max-w-[560px] lg:grid-cols-1",
                )}
              >
                {ordered.map(({ membershipId, organisation, roleKeys }) =>
                  organisation ? (
                    <li key={membershipId}>
                      <article
                        aria-label={organisation.name}
                        className="chelth-locked flex h-full flex-col gap-4 rounded-[14px] border border-[rgba(18,107,103,0.10)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,252,252,0.95))] p-5 shadow-[0_10px_30px_rgba(13,47,66,0.07),0_1px_2px_rgba(13,47,66,0.05)]"
                      >
                        <div className="flex items-start gap-3.5">
                          <span
                            aria-hidden="true"
                            className="inline-flex size-12 shrink-0 items-center justify-center rounded-[12px] bg-[radial-gradient(circle_at_30%_25%,#f4fdfa_0%,#d3f2e8_45%,#a9e3d3_100%)] text-chelth-teal-dark shadow-[0_4px_12px_rgba(0,90,96,0.14),inset_0_1px_0_rgba(255,255,255,0.9)] [&>svg]:size-6"
                          >
                            <WorkspaceNavIcon
                              name={organisation.type === "agency" ? "workforce" : "facilities"}
                              strokeWidth={1.9}
                              duotone
                            />
                          </span>
                          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                            <h3 className="font-display text-[18px] leading-6 font-semibold tracking-[-0.01em] break-words text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]">
                              {organisation.name}
                            </h3>
                            <div className="flex flex-wrap gap-1.5">
                              <RefChip tone="info" className="font-semibold">
                                {organisation.type === "agency" ? "Agency" : "Facility"}
                              </RefChip>
                              {organisation.status !== "active" ? (
                                <RefChip tone="warning" className="font-semibold">
                                  Suspended
                                </RefChip>
                              ) : null}
                              {organisation.id === preferredOrganisationId ? (
                                <RefChip tone="neutral" className="font-normal">
                                  Last used
                                </RefChip>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <p className="flex items-center gap-2 text-[14px] leading-5 text-slate-700">
                          <WorkspaceNavIcon
                            name="compliance"
                            strokeWidth={2.1}
                            className="size-[18px] shrink-0 text-chelth-teal-dark"
                          />
                          <span className="sr-only">Your role: </span>
                          {roleSummary(roleKeys.map((key) => roleName.get(key) ?? key))}
                        </p>
                        <form action={selectOrganisationAction} className="mt-auto">
                          <input type="hidden" name="organisationId" value={organisation.id} />
                          <Button type="submit" className="w-full">
                            Open workspace
                            <span className="sr-only"> {organisation.name}</span>
                          </Button>
                        </form>
                      </article>
                    </li>
                  ) : null,
                )}
              </ul>
            )}
          </section>
        </div>

        <section
          aria-labelledby="create-heading"
          className="flex flex-col gap-4 rounded-[14px] border border-[rgba(18,107,103,0.10)] bg-white/80 p-5 shadow-[0_1px_2px_rgba(13,47,66,0.04)] sm:p-6"
        >
          <div className="flex flex-col gap-1">
            <h2
              id="create-heading"
              className="font-display text-[18px] leading-6 font-semibold text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]"
            >
              Create a new agency
            </h2>
            <p className="text-[14px] leading-5 text-slate-600">
              Use Chelth for a separate staffing organisation.
            </p>
          </div>
          <div className="chelth-locked">
            <CreateOrganisationForm />
          </div>
        </section>
      </div>
    </div>
  );
}

const WORKER_CARD =
  "chelth-locked flex h-full flex-col gap-4 rounded-[14px] border border-[rgba(18,107,103,0.10)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,252,252,0.95))] p-5 shadow-[0_10px_30px_rgba(13,47,66,0.07),0_1px_2px_rgba(13,47,66,0.05)]";

/**
 * Worker-only agency chooser (P0-E9-3B): only the agencies this person works
 * with as a Healthcare Worker, each opening that agency's My Shifts. No agency
 * creation or administration here; Account and Security stay in the
 * personal navigation.
 */
function WorkerAgencyChooser({
  agencies,
  displayName,
  notice,
  pendingInvite,
}: {
  agencies: { id: string; name: string }[];
  displayName: string | null;
  notice: string | undefined;
  pendingInvite: boolean;
}) {
  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        variant="reference"
        title={
          agencies.length > 1
            ? "Choose an agency"
            : `Welcome${displayName ? `, ${displayName}` : ""}`
        }
        description={<p>Open your shifts with an agency you work with.</p>}
      />
      {notice ? (
        <p
          role="status"
          className="rounded-[12px] border border-[rgba(18,107,103,0.12)] bg-[linear-gradient(180deg,#f6fbfa,#eef7f4)] px-4 py-3 text-sm font-medium text-chelth-navy"
        >
          {notice}
        </p>
      ) : null}
      {pendingInvite ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[rgba(47,116,240,0.14)] bg-info-soft/45 px-4 py-3 text-sm text-chelth-navy"
        >
          <span className="font-medium">You have a pending invitation.</span>
          <Link
            href="/invite"
            className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
          >
            Review invitation
          </Link>
        </div>
      ) : null}
      <ul
        aria-label="Your agencies"
        className={cn(
          "grid gap-4 sm:grid-cols-2",
          agencies.length === 1 && "lg:max-w-[560px] lg:grid-cols-1",
        )}
      >
        {agencies.map((agency) => (
          <li key={agency.id}>
            <article aria-label={agency.name} className={WORKER_CARD}>
              <div className="flex items-start gap-3.5">
                <span
                  aria-hidden="true"
                  className="inline-flex size-12 shrink-0 items-center justify-center rounded-[12px] bg-[radial-gradient(circle_at_30%_25%,#f4fdfa_0%,#d3f2e8_45%,#a9e3d3_100%)] text-chelth-teal-dark shadow-[0_4px_12px_rgba(0,90,96,0.14),inset_0_1px_0_rgba(255,255,255,0.9)] [&>svg]:size-6"
                >
                  <WorkspaceNavIcon name="workforce" strokeWidth={1.9} duotone />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <h2 className="font-display text-[18px] leading-6 font-semibold tracking-[-0.01em] break-words text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]">
                    {agency.name}
                  </h2>
                  <div className="flex flex-wrap gap-1.5">
                    <RefChip tone="info" className="font-semibold">
                      Healthcare Worker
                    </RefChip>
                  </div>
                </div>
              </div>
              <Link
                href={`/app/organisations/${agency.id}/my-shifts` as Route}
                className="mt-auto inline-flex h-11 w-full items-center justify-center rounded-md bg-[linear-gradient(180deg,#00666c,#004f55)] px-4 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_14px_-4px_rgba(0,58,64,0.45)] hover:brightness-110"
              >
                Open shifts
                <span className="sr-only"> with {agency.name}</span>
              </Link>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}
