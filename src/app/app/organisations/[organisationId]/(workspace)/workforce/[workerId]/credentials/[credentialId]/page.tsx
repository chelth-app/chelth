import type { Metadata } from "next";
import Link from "next/link";

import { Panel } from "@/components/ui/panel";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
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
      <PageHeader
        title={credential.typeName}
        back={
          <Link
            href={`/app/organisations/${organisationId}/workforce/${worker.id}`}
            className="text-primary underline underline-offset-4"
          >
            {worker.displayName ?? "Worker"}
          </Link>
        }
        description={
          <p className="text-sm">
            {[credential.jurisdictionCode, credential.issuingAuthority]
              .filter(Boolean)
              .join(" · ") || "—"}
            {credential.credentialNumber ? ` · No. ${credential.credentialNumber}` : ""}
          </p>
        }
        meta={
          credential.status === "withdrawn" ? (
            <StatusChip tone="neutral">Withdrawn by the worker</StatusChip>
          ) : undefined
        }
      />

      {review === "step_up_required" || verify === "step_up_required" ? (
        <StepUpNotice returnTo={returnTo}>
          Opening documents and recording decisions require verification with your authenticator
          app.
        </StepUpNotice>
      ) : null}

      <Panel titleId="evidence-heading" title={<>Evidence</>}>
        <ol className="flex flex-col gap-3">
          {credential.versions
            .filter((version) => version.status === "submitted")
            .map((version) => {
              const decision = ownDecisions.find((item) => item.versionId === version.id);
              return (
                <li
                  key={version.id}
                  className="flex flex-col gap-2 rounded-md bg-surface-muted p-4 text-sm"
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
          <EmptyState headingLevel={3} title="Nothing has been submitted for review yet." />
        ) : null}
      </Panel>

      {verify === "granted" && latestSubmitted && credential.status === "active" ? (
        <Panel titleId="decision-heading" title={<>Record a decision</>}>
          <VerificationForm
            organisationId={organisationId}
            workerId={worker.id}
            credentialId={credential.id}
            versionId={latestSubmitted.id}
            versionLabel={`version ${latestSubmitted.number}`}
            facilities={facilities ? facilities.map(({ id, name }) => ({ id, name })) : null}
          />
        </Panel>
      ) : null}

      <Panel titleId="history-heading" title={<>{organisation.name} decision history</>}>
        {ownDecisions.length === 0 ? (
          <EmptyState headingLevel={3} title="No decisions recorded." />
        ) : (
          <ul className="flex flex-col divide-y divide-border border-y border-border text-sm">
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
      </Panel>
    </>
  );
}
