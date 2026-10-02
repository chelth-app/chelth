import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { Badge } from "@/components/ui/badge";
import {
  credentialIdSchema,
  DocumentStatusBadge,
  DocumentUploader,
  getCredential,
  NewVersionForm,
  OpenDocumentButton,
  revokeShareAction,
  shareCredentialAction,
  submitVersionAction,
  VerificationBadge,
  withdrawCredentialAction,
  withdrawVersionAction,
} from "@/features/credentials";
import { listMyMemberships, loadOrganisationPage } from "@/features/organisations";
import { REJECTION_REASON_LABELS } from "@/lib/domain/credentials";

export const metadata: Metadata = { title: "Credential" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default async function MyCredentialPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/my-credentials/[credentialId]">) {
  const { organisationId: rawOrganisationId, credentialId: rawCredentialId } = await params;
  const { organisationId, organisation, userId } = await loadOrganisationPage(rawOrganisationId);
  const credentialId = credentialIdSchema.safeParse(rawCredentialId);
  if (!credentialId.success) notFound();
  const credential = await getCredential(credentialId.data);
  // Owner-only page (agency staff use the review page).
  if (!credential || credential.profileId !== userId) notFound();

  const memberships = await listMyMemberships();
  const agencyName = new Map(
    memberships.flatMap((membership) =>
      membership.organisation ? [[membership.organisation.id, membership.organisation.name]] : [],
    ),
  );
  const activeShare = credential.shares.find(
    (share) => share.agencyOrganisationId === organisationId && share.status === "active",
  );
  const draft = credential.versions.find((version) => version.status === "draft");
  const isActive = credential.status === "active";
  const base = { organisationId, credentialId: credential.id };

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}/my-credentials`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          My credentials
        </Link>
        <h1 className="text-2xl font-semibold">{credential.typeName}</h1>
        <p className="text-sm text-muted-foreground">
          {[
            credential.jurisdictionCode,
            credential.issuingAuthority,
            credential.credentialNumber ? `No. ${credential.credentialNumber}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "—"}
        </p>
        {!isActive ? <Badge tone="neutral">Withdrawn</Badge> : null}
      </header>

      <section aria-labelledby="sharing-heading" className="flex flex-col gap-2">
        <h2 id="sharing-heading" className="text-lg font-semibold">
          Sharing with {organisation.name}
        </h2>
        {activeShare ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge tone="info">Shared</Badge>
            <InlineActionForm
              action={revokeShareAction}
              fields={{ ...base, shareId: activeShare.id }}
              label="Stop sharing"
              variant="ghost"
            />
          </div>
        ) : isActive ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge tone="neutral">Not shared</Badge>
            <InlineActionForm
              action={shareCredentialAction}
              fields={base}
              label={`Share with ${organisation.name}`}
            />
          </div>
        ) : null}
      </section>

      <section aria-labelledby="versions-heading" className="flex flex-col gap-3">
        <h2 id="versions-heading" className="text-lg font-semibold">
          Versions
        </h2>
        <ol className="flex flex-col gap-3">
          {credential.versions.map((version) => (
            <li
              key={version.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  Version {version.number}
                  {version.issueDate ? ` · issued ${version.issueDate}` : ""}
                  {version.expiryDate ? ` · expires ${version.expiryDate}` : ""}
                </span>
                <Badge tone={version.status === "submitted" ? "info" : "neutral"}>
                  {version.status === "draft"
                    ? "Draft"
                    : version.status === "submitted"
                      ? "Submitted"
                      : "Withdrawn"}
                </Badge>
              </div>
              {version.documents.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {version.documents.map((document, index) => (
                    <li key={document.id} className="flex flex-wrap items-center gap-2">
                      <span>Document {index + 1}</span>
                      <DocumentStatusBadge status={document.status} />
                      {document.status === "clean" || document.status === "scanning" ? (
                        <OpenDocumentButton
                          documentId={document.id}
                          label={`Open document ${index + 1} of version ${version.number}`}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {version.status === "draft" && isActive ? (
                <div className="flex flex-col gap-3">
                  {credential.requiresDocument ? <DocumentUploader versionId={version.id} /> : null}
                  <div className="flex flex-wrap gap-2">
                    <InlineActionForm
                      action={submitVersionAction}
                      fields={{ ...base, versionId: version.id }}
                      label="Submit for review"
                      variant="primary"
                    />
                    <InlineActionForm
                      action={withdrawVersionAction}
                      fields={{ ...base, versionId: version.id }}
                      label="Discard draft"
                      variant="ghost"
                    />
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        {isActive && !draft ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">Renew</h3>
            <p className="text-sm text-muted-foreground">
              A renewal adds a new version. Earlier versions are kept.
            </p>
            <NewVersionForm {...base} />
          </div>
        ) : null}
      </section>

      <section aria-labelledby="verification-heading" className="flex flex-col gap-3">
        <h2 id="verification-heading" className="text-lg font-semibold">
          Verification by agencies
        </h2>
        {credential.verifications.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No agency has reviewed this credential yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface text-sm">
            {credential.verifications.map((verification) => (
              <li
                key={verification.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <span>
                  {agencyName.get(verification.agencyOrganisationId) ?? "An agency"} · version{" "}
                  {credential.versions.find((version) => version.id === verification.versionId)
                    ?.number ?? "?"}
                  {verification.rejectionReason
                    ? ` · ${REJECTION_REASON_LABELS[verification.rejectionReason]}`
                    : ""}
                </span>
                <span className="flex items-center gap-2">
                  <VerificationBadge outcome={verification.outcome} />
                  <time dateTime={verification.createdAt} className="text-muted-foreground">
                    {dateTime.format(new Date(verification.createdAt))}
                  </time>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isActive ? (
        <section aria-labelledby="withdraw-heading" className="flex flex-col gap-2">
          <h2 id="withdraw-heading" className="text-lg font-semibold">
            Withdraw
          </h2>
          <p className="text-sm text-muted-foreground">
            Withdrawing stops this credential counting anywhere. History is kept.
          </p>
          <InlineActionForm
            action={withdrawCredentialAction}
            fields={base}
            label="Withdraw credential"
            variant="danger"
          />
        </section>
      ) : null}
    </>
  );
}
