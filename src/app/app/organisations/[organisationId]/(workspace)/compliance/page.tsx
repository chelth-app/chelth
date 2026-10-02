import type { Metadata } from "next";
import Link from "next/link";

import { listRequirements, RequirementForm, RequirementsTable } from "@/features/compliance";
import { listCredentialTypes, listDisciplines, listJurisdictions } from "@/features/credentials";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";

export const metadata: Metadata = { title: "Credential requirements" };

/** Agency baseline requirements. Facility add-ons live on each facility. */
export default async function CompliancePage({
  params,
}: PageProps<"/app/organisations/[organisationId]/compliance">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.CREDENTIAL_REQUIREMENTS_VIEW);
  const { organisationId, organisation, can } = context;
  const manage = can(CAPABILITIES.CREDENTIAL_REQUIREMENTS_MANAGE);

  const [requirements, credentialTypes, disciplines, jurisdictions] = await Promise.all([
    listRequirements(organisationId),
    listCredentialTypes(),
    listDisciplines(),
    listJurisdictions(),
  ]);

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          {organisation.name}
        </Link>
        <h1 className="text-2xl font-semibold">Credential requirements</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Baseline requirements apply to every worker at {organisation.name} (or to one discipline).
          Client facilities can add their own on the facility page. Readiness is always calculated
          from these requirements and the worker&apos;s evidence — it is never set by hand.
        </p>
      </header>

      {manage === "step_up_required" ? (
        <StepUpNotice returnTo={`/app/organisations/${organisationId}/compliance`}>
          Changing requirements requires verification with your authenticator app.
        </StepUpNotice>
      ) : null}

      <section aria-labelledby="baseline-heading" className="flex flex-col gap-3">
        <h2 id="baseline-heading" className="text-lg font-semibold">
          Agency baseline
        </h2>
        <RequirementsTable
          organisationId={organisationId}
          requirements={requirements}
          typeNames={new Map(credentialTypes.map((type) => [type.key, type.name]))}
          disciplineNames={
            new Map(disciplines.map((discipline) => [discipline.key, discipline.name]))
          }
          canManage={manage === "granted"}
          label="Agency baseline requirements"
        />
      </section>

      {manage === "granted" ? (
        <section aria-labelledby="add-baseline-heading" className="flex flex-col gap-3">
          <h2 id="add-baseline-heading" className="text-lg font-semibold">
            Add a baseline requirement
          </h2>
          <RequirementForm
            organisationId={organisationId}
            credentialTypes={credentialTypes}
            disciplines={disciplines}
            jurisdictions={jurisdictions.filter(
              (jurisdiction) => jurisdiction.level === "subdivision",
            )}
            effectiveFromHint="Choose the calendar date it applies from. Each shift is checked against its facility's local date."
          />
        </section>
      ) : null}
    </>
  );
}
