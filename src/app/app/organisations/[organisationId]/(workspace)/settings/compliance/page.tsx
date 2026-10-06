import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import type { WorkspaceNavIcon as IconName } from "@/components/layout/workspace-navigation-model";
import { RefChip } from "@/components/reference/locked-reference";
import { RecordNote } from "@/components/reference/record-page";
import { Panel } from "@/components/ui/panel";
import { listRequirements } from "@/features/compliance";
import { listCredentialTypes, listDisciplines } from "@/features/credentials";
import { loadOrganisationPage } from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";
import { formatCalendarDate, READINESS_LABELS } from "@/lib/domain/credentials";

import { canOpenSection } from "../_components/settings-sections";
import {
  SettingsActionLink,
  SettingsActionRow,
  SettingsExplanationList,
  SettingsExplanationRow,
  SettingsRelatedLinks,
  SettingsStatusSummary,
} from "../_components/settings-ui";

export const metadata: Metadata = { title: "Credentials & Compliance" };

/**
 * Settings → Credentials & Compliance. Settings configures, Compliance
 * monitors: baseline requirements are added and deactivated on the
 * Compliance page and facility add-ons on each facility record. This section
 * shows the active rules (same loader), explains how the readiness engine
 * uses them (its real inputs, nothing configurable here) and links to the
 * existing compliance surfaces. No editable controls.
 */
export default async function SettingsCompliancePage({
  params,
}: PageProps<"/app/organisations/[organisationId]/settings/compliance">) {
  const context = await loadOrganisationPage((await params).organisationId);
  const { organisationId, organisation, can } = context;
  if (!canOpenSection("compliance", organisation.type, can)) notFound();
  const [requirements, credentialTypes, disciplines] = await Promise.all([
    can(CAPABILITIES.CREDENTIAL_REQUIREMENTS_VIEW) === "granted"
      ? listRequirements(organisationId)
      : Promise.resolve([]),
    listCredentialTypes(),
    listDisciplines(),
  ]);
  const typeName = new Map(credentialTypes.map((type) => [type.key, type.name]));
  const disciplineName = new Map(
    disciplines.map((discipline) => [discipline.key, discipline.name]),
  );
  const active = requirements.filter((requirement) => requirement.status === "active");
  const inactive = requirements.length - active.length;
  const canFacilities = can(CAPABILITIES.FACILITY_VIEW) !== "not_held";
  const canWorkforce = can(CAPABILITIES.WORKER_VIEW) !== "not_held";
  const base = `/app/organisations/${organisationId}`;

  const inputs: { icon: IconName; title: string; note: ReactNode }[] = [
    {
      icon: "compliance",
      title: "Agency baseline requirements",
      note: "Apply to every worker, or to one discipline, from their effective date.",
    },
    {
      icon: "facilities",
      title: "Facility-specific requirements",
      note: "Added on each facility record and checked only for work at that facility.",
    },
    {
      icon: "workforce",
      title: "Worker credential evidence",
      note: "Credentials the worker has submitted and shared; documents count only once the security scan clears them.",
    },
    {
      icon: "requests",
      title: "Verification status",
      note: "Where a requirement must be verified, your agency's verification decision is needed.",
    },
    {
      icon: "shifts",
      title: "Expiration and effective dates",
      note: "A credential must be valid on the shift's local date, for any minimum validity; the warning window flags upcoming expiry.",
    },
  ];

  const related: { icon: IconName; title: string; note: string; href: string }[] = [
    {
      icon: "compliance",
      title: "Compliance",
      note: "Credential register, readiness results and baseline management.",
      href: `${base}/compliance`,
    },
    ...(canFacilities
      ? [
          {
            icon: "facilities" as const,
            title: "Facilities",
            note: "Facility-specific requirements on each facility record.",
            href: `${base}/facilities`,
          },
        ]
      : []),
    ...(canWorkforce
      ? [
          {
            icon: "workforce" as const,
            title: "Workforce",
            note: "Worker records, readiness and credential review.",
            href: `${base}/workforce`,
          },
        ]
      : []),
  ];

  return (
    <>
      <Panel
        titleId="requirement-rules-heading"
        title={<>Credential Requirement Rules</>}
        description={
          <>
            Applies to every worker, or to one discipline. Facilities add their own on each facility
            record.
          </>
        }
        action={
          <RefChip tone="success" className="font-semibold">
            {active.length} active
          </RefChip>
        }
      >
        {active.length === 0 ? (
          <RecordNote>No active baseline requirements.</RecordNote>
        ) : (
          <SettingsExplanationList label="Active baseline requirements">
            {active.map((requirement) => (
              <SettingsExplanationRow
                key={requirement.id}
                icon="compliance"
                title={typeName.get(requirement.credentialTypeKey) ?? requirement.credentialTypeKey}
                note={[
                  requirement.disciplineKey
                    ? (disciplineName.get(requirement.disciplineKey) ?? requirement.disciplineKey)
                    : "All workers",
                  requirement.jurisdictionCode,
                  `from ${formatCalendarDate(requirement.effectiveFrom)}`,
                  requirement.minimumValidityDays > 0
                    ? `valid ≥ ${requirement.minimumValidityDays} days`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={
                  <>
                    <RefChip
                      tone={requirement.mustBeVerified ? "info" : "neutral"}
                      className="font-normal"
                    >
                      {requirement.mustBeVerified
                        ? "Must be verified"
                        : "Verification not required"}
                    </RefChip>
                    <RefChip tone="warning" className="font-normal">
                      Warn {requirement.expiryWarningDays} days before expiry
                    </RefChip>
                  </>
                }
              />
            ))}
          </SettingsExplanationList>
        )}
        {inactive > 0 ? (
          <RecordNote>
            {inactive} inactive {inactive === 1 ? "requirement is" : "requirements are"} kept for
            history on Compliance.
          </RecordNote>
        ) : null}
        <SettingsActionRow>
          <SettingsActionLink href={`${base}/compliance#baseline-heading`} icon="compliance">
            Manage baseline requirements
          </SettingsActionLink>
          {canFacilities ? (
            <SettingsActionLink href={`${base}/facilities`} icon="facilities">
              Manage facility requirements
            </SettingsActionLink>
          ) : null}
        </SettingsActionRow>
      </Panel>

      <Panel
        titleId="readiness-calculation-heading"
        title={<>How Readiness Is Calculated</>}
        description={
          <>
            Chelth&apos;s readiness engine checks each worker against these inputs. Readiness is
            never set by hand.
          </>
        }
      >
        <SettingsExplanationList label="Readiness inputs">
          {inputs.map((input) => (
            <SettingsExplanationRow
              key={input.title}
              icon={input.icon}
              title={input.title}
              note={input.note}
            />
          ))}
        </SettingsExplanationList>
        <SettingsStatusSummary
          label="Results"
          items={[
            { tone: "success", label: READINESS_LABELS.ready },
            { tone: "warning", label: READINESS_LABELS.action_required },
            { tone: "danger", label: READINESS_LABELS.not_eligible },
          ]}
        />
        <SettingsActionRow>
          <SettingsActionLink href={`${base}/compliance`}>View Compliance</SettingsActionLink>
          {canFacilities ? (
            <SettingsActionLink href={`${base}/facilities`}>
              Manage Facility Requirements
            </SettingsActionLink>
          ) : null}
        </SettingsActionRow>
      </Panel>

      <Panel titleId="related-compliance-heading" title={<>Related Compliance Areas</>}>
        <SettingsRelatedLinks label="Related compliance areas" items={related} />
      </Panel>
    </>
  );
}
