import type { ReactNode } from "react";

import { WorkerShell, type WorkerNavItem } from "@/components/layout/worker-shell";
import { getMyProfile, signOutAction } from "@/features/identity";
import { unreadMessageCount } from "@/features/messaging";
import {
  getMyCapabilities,
  getOrganisation,
  listMyMemberships,
  organisationIdSchema,
  selectOrganisationAction,
  workerOnlyAgencies,
} from "@/features/organisations";
import { getMyWorkerRecord } from "@/features/workforce";
import { requireAuthIdentity } from "@/lib/auth/session";
import { CAPABILITIES, capabilityState } from "@/lib/authz";
import { WORKER_STATUS_LABELS } from "@/lib/domain/vocabulary";

import { PersonalFrame } from "../../../_components/personal-frame";

const TYPE_LABEL = { agency: "Agency", facility: "Facility" } as const;

/**
 * Worker self-service frame (P7, P0-E8-S6). Chosen on the server; renders the
 * mobile-first WorkerShell when the caller has a worker record in this agency,
 * otherwise the personal frame (and the page applies its own 404 as before).
 *
 * Bottom navigation lists only real destinations, with the same predicates
 * the pages use:
 *  - Shifts → my-shifts (own worker record);
 *  - Timesheets → timesheets, only when that route shows the worker's OWN
 *    timesheets (no timesheet.view; staff reviewers see the agency list in
 *    the workspace shell instead);
 *  - Credentials → my-credentials (worker record not terminated, as on the
 *    Overview).
 */
export async function WorkerFrame({
  rawOrganisationId,
  children,
}: {
  rawOrganisationId: string;
  children: ReactNode;
}) {
  const parsed = organisationIdSchema.safeParse(rawOrganisationId);
  if (!parsed.success) return <PersonalFrame>{children}</PersonalFrame>;
  const organisationId = parsed.data;
  const [identity, organisation] = await Promise.all([
    requireAuthIdentity(),
    getOrganisation(organisationId),
  ]);
  if (!organisation || organisation.type !== "agency") {
    return <PersonalFrame>{children}</PersonalFrame>;
  }
  const [worker, grants, profile, memberships, unreadMessages] = await Promise.all([
    getMyWorkerRecord(organisationId),
    getMyCapabilities(organisationId),
    getMyProfile(),
    listMyMemberships(),
    unreadMessageCount(organisationId),
  ]);
  if (!worker) return <PersonalFrame>{children}</PersonalFrame>;

  const base = `/app/organisations/${organisationId}`;
  const reviewsTimesheets = capabilityState(grants, CAPABILITIES.TIMESHEET_VIEW) !== "not_held";
  const items: WorkerNavItem[] = [
    { label: "Shifts", href: `${base}/my-shifts`, icon: "shifts" },
    ...(reviewsTimesheets
      ? []
      : [{ label: "Timesheets", href: `${base}/timesheets`, icon: "timesheets" as const }]),
    ...(worker.status !== "terminated"
      ? [{ label: "Credentials", href: `${base}/my-credentials`, icon: "credentials" as const }]
      : []),
  ];
  const otherWorkspaces = memberships.flatMap(({ organisation: other }) =>
    other && other.id !== organisationId
      ? [{ id: other.id, name: other.name, typeLabel: TYPE_LABEL[other.type] }]
      : [],
  );
  // P0-E9-3C: worker-only accounts see agencies, and a single agency has no chooser.
  const workerAgencies = workerOnlyAgencies(
    memberships.filter((membership) => membership.organisation !== null),
  );
  const chooserLabel = workerAgencies
    ? workerAgencies.length > 1
      ? "All agencies"
      : null
    : "All workspaces";

  return (
    <WorkerShell
      workspaceName={organisation.name}
      user={{ displayName: profile.displayName, email: identity.email }}
      items={items}
      homeHref={`${base}/my-shifts`}
      otherWorkspaces={otherWorkspaces}
      chooserLabel={chooserLabel}
      switchLabel={workerAgencies ? "Switch agency" : "Switch workspace"}
      workerStatusLabel={WORKER_STATUS_LABELS[worker.status]}
      messagesHref={`${base}/messages`}
      unreadMessages={unreadMessages}
      selectWorkspaceAction={selectOrganisationAction}
      signOutAction={signOutAction}
    >
      {children}
    </WorkerShell>
  );
}
