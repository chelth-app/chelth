import type { Metadata } from "next";
import Link from "next/link";

import { Panel } from "@/components/ui/panel";

import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
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
      <PageHeader
        title="Credential requirements"
        back={
          <Link
            href={`/app/organisations/${organisationId}`}
            className="text-primary underline underline-offset-4"
          >
            {organisation.name}
          </Link>
        }
        description={
          <p>
            Baseline requirements apply to every worker at {organisation.name} (or to one
            discipline). Client facilities can add their own on the facility page. Readiness is
            always calculated from these requirements and the worker&apos;s evidence — it is never
            set by hand.
          </p>
        }
        meta={
          <>
            <StatusChip tone="success">
              {requirements.filter((requirement) => requirement.status === "active").length} active
            </StatusChip>
            <StatusChip tone="neutral">
              {requirements.filter((requirement) => requirement.status !== "active").length}{" "}
              inactive
            </StatusChip>
          </>
        }
        primaryAction={
          manage === "granted" ? (
            <a
              href="#add-baseline-heading"
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              Add requirement
            </a>
          ) : undefined
        }
      />

      {manage === "step_up_required" ? (
        <StepUpNotice returnTo={`/app/organisations/${organisationId}/compliance`}>
          Changing requirements requires verification with your authenticator app.
        </StepUpNotice>
      ) : null}

      <Panel titleId="baseline-heading" title={<>Agency baseline</>}>
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
      </Panel>

      {manage === "granted" ? (
        <Panel titleId="add-baseline-heading" title={<>Add a baseline requirement</>}>
          <RequirementForm
            organisationId={organisationId}
            credentialTypes={credentialTypes}
            disciplines={disciplines}
            jurisdictions={jurisdictions.filter(
              (jurisdiction) => jurisdiction.level === "subdivision",
            )}
            effectiveFromHint="Choose the calendar date it applies from. Each shift is checked against its facility's local date."
          />
        </Panel>
      ) : null}
    </>
  );
}
