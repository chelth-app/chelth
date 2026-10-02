import { AppShell } from "@/components/layout/app-shell";
import { getMyProfile, signOutAction } from "@/features/identity";
import {
  buildWorkspaceNavigation,
  getMyCapabilities,
  getOrganisation,
  isWorkspaceStaff,
  listMyMemberships,
  listRoles,
  organisationIdSchema,
  selectOrganisationAction,
} from "@/features/organisations";
import { getMyWorkerRecord } from "@/features/workforce";
import { requireAuthIdentity } from "@/lib/auth/session";
import { capabilityState } from "@/lib/authz";

import { PersonalFrame } from "../../../_components/personal-frame";

const TYPE_LABEL = { agency: "Agency", facility: "Facility" } as const;

/**
 * Shared Agency / Facility workspace shell (P0-E8-S1).
 *
 * The navigation is derived from the caller's capabilities in this
 * organisation (UI hint only — every page still applies its own gate and
 * every operation is re-authorised by the database). Members with
 * self-service access only, and ids the caller cannot see (the page renders
 * 404), keep the personal frame.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: LayoutProps<"/app/organisations/[organisationId]">) {
  const { organisationId: rawId } = await params;
  const parsedId = organisationIdSchema.safeParse(rawId);
  if (!parsedId.success) return <PersonalFrame>{children}</PersonalFrame>;
  const organisationId = parsedId.data;

  const [identity, organisation] = await Promise.all([
    requireAuthIdentity(),
    getOrganisation(organisationId),
  ]);
  if (!organisation) return <PersonalFrame>{children}</PersonalFrame>;

  const grants = await getMyCapabilities(organisationId);
  if (!isWorkspaceStaff(grants.map((grant) => grant.capabilityKey))) {
    return <PersonalFrame>{children}</PersonalFrame>;
  }

  const [profile, memberships, roles, myWorkerRecord] = await Promise.all([
    getMyProfile(),
    listMyMemberships(),
    listRoles(organisation.type),
    organisation.type === "agency" ? getMyWorkerRecord(organisationId) : Promise.resolve(null),
  ]);

  const roleName = new Map(roles.map((role) => [role.key, role.name]));
  const roleKeys =
    memberships.find((membership) => membership.organisation?.id === organisationId)?.roleKeys ??
    [];
  const roleLabel = roleKeys.map((key) => roleName.get(key) ?? key).join(", ") || null;

  const otherWorkspaces = memberships.flatMap(({ organisation: other }) =>
    other && other.id !== organisationId
      ? [{ id: other.id, name: other.name, typeLabel: TYPE_LABEL[other.type] }]
      : [],
  );

  const navigation = buildWorkspaceNavigation({
    organisationId,
    organisationType: organisation.type,
    can: (capability) => capabilityState(grants, capability),
    hasWorkerRecord: myWorkerRecord !== null,
  });

  return (
    <AppShell
      navigation={navigation}
      workspace={{
        id: organisationId,
        name: organisation.name,
        typeLabel: TYPE_LABEL[organisation.type],
        roleLabel,
        suspended: organisation.status !== "active",
      }}
      user={{ displayName: profile.displayName, email: identity.email }}
      otherWorkspaces={otherWorkspaces}
      selectWorkspaceAction={selectOrganisationAction}
      signOutAction={signOutAction}
    >
      {children}
    </AppShell>
  );
}
