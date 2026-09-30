import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  credentialIdSchema,
  DocumentStatusBadge,
  getCredential,
  OpenDocumentButton,
  VerificationBadge,
  VerificationForm,
} from "@/features/credentials";
import { listFacilities } from "@/features/facilities";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { getWorker, workerIdSchema } from "@/features/workforce";
import { CAPABILITIES } from "@/lib/authz";
import { REJECTION_REASON_LABELS } from "@/lib/domain/credentials";

export const metadata: Metadata = { title: "Credential review" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default async function CredentialReviewPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/workforce/[workerId]/credentials/[credentialId]">) {
  const {
    organisationId: rawOrganisationId,
    workerId: rawWorkerId,
    credentialId: rawCredentialId,
  } = await params;
  const context = await loadOrganisationPage(rawOrganisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.CREDENTIAL_VIEW);
  const workerId = workerIdSchema.safeParse(rawWorkerId);
  const credentialId = credentialIdSchema.safeParse(rawCredentialId);
  if (!workerId.success || !credentialId.success) notFound();

  const { organisationId, organisation, can } = context;
  const [worker, credential] = await Promise.all([
    getWorker(organisationId, workerId.data),
    getCredential(credentialId.data),
  ]);
  // RLS: visible only if shared with this agency and the caller holds credential.view.
  if (!worker || !credential || credential.profileId === context.userId) notFound();

  const review = can(CAPABILITIES.CREDENTIAL_REVIEW);
  const verify = can(CAPABILITIES.CREDENTIAL_VERIFY);
  const ownDecisions = credential.verifications.filter(
    (item) => item.agencyOrganisationId === organisationId,
  );
  const latestSubmitted = credential.versions.find((version) => version.status === "submitted");
  const facilities =
    credential.scope === "facility" && can(CAPABILITIES.FACILITY_VIEW) === "granted"
      ? (await listFacilities(organisationId)).filter((facility) => facility.status !== "archived")
      : null;
  const returnTo = `/app/organisations/${organisationId}/workforce/${worker.id}/credentials/${credential.id}`;

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}/workforce/${worker.id}`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          {worker.displayName ?? "Worker"}
        </Link>
        <h1 className="text-2xl font-semibold">{credential.typeName}</h1>
        <p className="text-sm text-muted-foreground">
          {[credential.jurisdictionCode, credential.issuingAuthority].filter(Boolean).join(" · ") ||
            "—"}
          {credential.credentialNumber ? ` · No. ${credential.credentialNumber}` : ""}
        </p>
        {credential.status === "withdrawn" ? (
          <Badge tone="neutral">Withdrawn by the worker</Badge>
        ) : null}
      </header>

      {review === "step_up_required" || verify === "step_up_required" ? (
        <StepUpNotice returnTo={returnTo}>
          Opening documents and recording decisions require verification with your authenticator
          app.
        </StepUpNotice>
      ) : null}

      <section aria-labelledby="evidence-heading" className="flex flex-col gap-3">
        <h2 id="evidence-heading" className="text-lg font-semibold">
          Evidence
        </h2>
        <ol className="flex flex-col gap-3">
          {credential.versions
            .filter((version) => version.status === "submitted")
            .map((version) => {
              const decision = ownDecisions.find((item) => item.versionId === version.id);
              return (
                <li
                  key={version.id}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      Version {version.number}
                      {version.issueDate ? ` · issued ${version.issueDate}` : ""}
                      {version.expiryDate ? ` · expires ${version.expiryDate}` : ""}
                    </span>
                    <VerificationBadge outcome={decision?.outcome ?? null} />
                  </div>
                  <ul className="flex flex-col gap-2">
                    {version.documents.map((document, index) => (
                      <li key={document.id} className="flex flex-wrap items-center gap-2">
                        <span>Document {index + 1}</span>
                        <DocumentStatusBadge status={document.status} />
                        {review === "granted" && document.status === "clean" ? (
                          <OpenDocumentButton
                            documentId={document.id}
                            organisationId={organisationId}
                            label={`Open document ${index + 1} of version ${version.number}`}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
        </ol>
        {!latestSubmitted ? (
          <p className="text-sm text-muted-foreground">
            Nothing has been submitted for review yet.
          </p>
        ) : null}
      </section>

      {verify === "granted" && latestSubmitted && credential.status === "active" ? (
        <section aria-labelledby="decision-heading" className="flex flex-col gap-3">
          <h2 id="decision-heading" className="text-lg font-semibold">
            Record a decision
          </h2>
          <VerificationForm
            organisationId={organisationId}
            workerId={worker.id}
            credentialId={credential.id}
            versionId={latestSubmitted.id}
            versionLabel={`version ${latestSubmitted.number}`}
            facilities={facilities ? facilities.map(({ id, name }) => ({ id, name })) : null}
          />
        </section>
      ) : null}

      <section aria-labelledby="history-heading" className="flex flex-col gap-3">
        <h2 id="history-heading" className="text-lg font-semibold">
          {organisation.name} decision history
        </h2>
        {ownDecisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No decisions recorded.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface text-sm">
            {ownDecisions.map((decision) => (
              <li
                key={decision.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <span>
                  Version{" "}
                  {credential.versions.find((version) => version.id === decision.versionId)
                    ?.number ?? "?"}
                  {decision.rejectionReason
                    ? ` · ${REJECTION_REASON_LABELS[decision.rejectionReason]}`
                    : ""}
                </span>
                <span className="flex items-center gap-2">
                  <VerificationBadge outcome={decision.outcome} />
                  <time dateTime={decision.createdAt} className="text-muted-foreground">
                    {dateTime.format(new Date(decision.createdAt))}
                  </time>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
