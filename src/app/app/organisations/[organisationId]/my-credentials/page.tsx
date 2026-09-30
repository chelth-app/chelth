import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
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
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          {organisation.name}
        </Link>
        <h1 className="text-2xl font-semibold">My credentials</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Your credentials belong to you. {organisation.name} can see a credential only while you
          share it with them, and they verify it independently of any other agency.
        </p>
      </header>

      <ReadinessPanel
        title={`Readiness at ${organisation.name}`}
        readiness={readiness}
        headingId="my-readiness"
      />

      <section aria-labelledby="my-credentials-heading" className="flex flex-col gap-3">
        <h2 id="my-credentials-heading" className="text-lg font-semibold">
          Credentials
        </h2>
        {credentials.length === 0 ? (
          <p className="text-sm text-muted-foreground">You have not added any credentials yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface text-sm">
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
                    <Badge tone="neutral">Withdrawn</Badge>
                  ) : null}
                  {credential.latestVersion?.expiryDate ? (
                    <span className="text-muted-foreground">
                      expires {credential.latestVersion.expiryDate}
                    </span>
                  ) : null}
                  <Badge tone={credential.sharedWithAgency ? "info" : "neutral"}>
                    {credential.sharedWithAgency
                      ? `Shared with ${organisation.name}`
                      : "Not shared"}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="add-credential-heading" className="flex flex-col gap-3">
        <h2 id="add-credential-heading" className="text-lg font-semibold">
          Add a credential
        </h2>
        <CreateCredentialForm
          organisationId={organisationId}
          organisationName={organisation.name}
          credentialTypes={credentialTypes}
          jurisdictions={jurisdictions}
        />
      </section>
    </>
  );
}
