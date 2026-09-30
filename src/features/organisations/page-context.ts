import "server-only";

import { notFound } from "next/navigation";

import { requireAuthIdentity } from "@/lib/auth/session";
import { type CapabilityKey, capabilityState, type CapabilityState } from "@/lib/authz";

import { getMyCapabilities, getOrganisation, type OrganisationSummary } from "./queries";
import { organisationIdSchema } from "./schemas";

export type OrganisationPageContext = {
  userId: string;
  organisationId: string;
  organisation: OrganisationSummary;
  /** UI hint only: every operation is re-authorised by the database. */
  can: (capability: CapabilityKey) => CapabilityState;
  needsStepUp: boolean;
};

/**
 * Resolves an organisation-scoped page. Invalid ids and organisations the
 * caller cannot see (RLS) both render 404 — indistinguishable by design.
 */
export async function loadOrganisationPage(
  rawOrganisationId: string,
): Promise<OrganisationPageContext> {
  const parsed = organisationIdSchema.safeParse(rawOrganisationId);
  if (!parsed.success) notFound();
  const organisationId = parsed.data;

  const [identity, organisation] = await Promise.all([
    requireAuthIdentity(),
    getOrganisation(organisationId),
  ]);
  if (!organisation) notFound();

  const grants = await getMyCapabilities(organisationId);
  return {
    userId: identity.userId,
    organisationId,
    organisation,
    can: (capability) => capabilityState(grants, capability),
    needsStepUp: grants.some((grant) => !grant.isSatisfied),
  };
}

/** 404 unless the capability is held (granted or pending step-up). */
export function requireCapabilityOrNotFound(
  context: OrganisationPageContext,
  capability: CapabilityKey,
): void {
  if (context.can(capability) === "not_held") notFound();
}
