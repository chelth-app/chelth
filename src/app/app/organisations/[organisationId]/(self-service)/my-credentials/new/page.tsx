import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import {
  CreateCredentialForm,
  listCredentialTypes,
  listJurisdictions,
} from "@/features/credentials";
import { loadOrganisationPage } from "@/features/organisations";
import { getMyWorkerRecord } from "@/features/workforce";

import { CredentialSteps, WorkerCardSection } from "../_components/credential-view";

export const metadata: Metadata = { title: "Add credential" };

/**
 * Add credential, step 1 of 3 (P0-E9-3C): the credential's details. Saving
 * creates the draft (and the share, when ticked) with the existing action and
 * opens its record, where Evidence and Review complete the flow.
 */
export default async function AddCredentialPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/my-credentials/new">) {
  const { organisationId, organisation } = await loadOrganisationPage(
    (await params).organisationId,
  );
  const worker = await getMyWorkerRecord(organisationId);
  if (!worker) notFound();
  const [credentialTypes, jurisdictions] = await Promise.all([
    listCredentialTypes(),
    listJurisdictions(),
  ]);

  return (
    <div className="chelth-locked flex flex-col gap-5">
      <PageHeader
        variant="reference"
        title="Add credential"
        back={
          <Link
            href={`/app/organisations/${organisationId}/my-credentials`}
            className="text-primary underline underline-offset-4"
          >
            My Credentials
          </Link>
        }
        description={<p>Add the details, then upload your evidence and submit it for review.</p>}
      />
      <CredentialSteps current={1} />
      <WorkerCardSection id="details-heading" title="Credential details">
        <CreateCredentialForm
          organisationId={organisationId}
          organisationName={organisation.name}
          credentialTypes={credentialTypes}
          jurisdictions={jurisdictions}
        />
      </WorkerCardSection>
    </div>
  );
}
