import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { getReadiness, ReadinessPanel } from "@/features/compliance";
import {
  CreateCredentialForm,
  listCredentialTypes,
  listJurisdictions,
  listMyCredentials,
} from "@/features/credentials";
import { loadOrganisationPage } from "@/features/organisations";
import { getMyWorkerRecord } from "@/features/workforce";

export const metadata: Metadata = { title: "My credentials" };

/**
 * The worker's own credential area in the context of one agency. Credentials
 * belong to the person; this page shows which of them are shared with this
 * agency and what this agency's requirements need.
 */
export default async function MyCredentialsPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/my-credentials">) {
  const { organisationId, organisation } = await loadOrganisationPage(
    (await params).organisationId,
  );
  const worker = await getMyWorkerRecord(organisationId);
  if (!worker) notFound();

  const [credentials, readiness, credentialTypes, jurisdictions] = await Promise.all([
    listMyCredentials(organisationId),
    getReadiness(worker.id),
    listCredentialTypes(),
    listJurisdictions(),
  ]);

  return (
    <>
      <PageHeader
        title="My credentials"
        description={
          <p className="text-sm">
            Your credentials belong to you. {organisation.name} can see a credential only while you
            share it with them, and they verify it independently of any other agency.
          </p>
        }
        primaryAction={
          <a
            href="#add-credential-heading"
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
          >
            Add a credential
          </a>
        }
      />

      <ReadinessPanel
        title={`Readiness at ${organisation.name}`}
        readiness={readiness}
        headingId="my-readiness"
      />

      <Panel titleId="my-credentials-heading" title={<>Credentials</>}>
        {credentials.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="You have not added any credentials yet."
            description="Add one below, upload its evidence and submit it for review."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border border-y border-border text-sm">
            {credentials.map((credential) => (
              <li
                key={credential.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <Link
                  href={`/app/organisations/${organisationId}/my-credentials/${credential.id}`}
                  className="font-medium text-primary underline underline-offset-4"
                >
                  {credential.typeName}
                  {credential.jurisdictionCode ? ` (${credential.jurisdictionCode})` : ""}
                </Link>
                <span className="flex flex-wrap items-center gap-2">
                  {credential.status === "withdrawn" ? (
                    <StatusChip tone="neutral">Withdrawn</StatusChip>
                  ) : null}
                  {credential.latestVersion?.expiryDate ? (
                    <span className="text-muted-foreground">
                      expires {credential.latestVersion.expiryDate}
                    </span>
                  ) : null}
                  <StatusChip tone={credential.sharedWithAgency ? "info" : "neutral"}>
                    {credential.sharedWithAgency
                      ? `Shared with ${organisation.name}`
                      : "Not shared"}
                  </StatusChip>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel titleId="add-credential-heading" title={<>Add a credential</>}>
        <CreateCredentialForm
          organisationId={organisationId}
          organisationName={organisation.name}
          credentialTypes={credentialTypes}
          jurisdictions={jurisdictions}
        />
      </Panel>
    </>
  );
}
