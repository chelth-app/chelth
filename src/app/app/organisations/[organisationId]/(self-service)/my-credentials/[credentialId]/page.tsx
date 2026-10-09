import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { RefChip } from "@/components/reference/locked-reference";
import {
  RECORD_ROW,
  RECORD_ROW_META,
  RECORD_ROW_TITLE,
  RecordList,
  RecordMeta,
  RecordNote,
  RecordPage,
  RecordStatusBlock,
} from "@/components/reference/record-page";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
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
import { formatCalendarDate, REJECTION_REASON_LABELS } from "@/lib/domain/credentials";

import { WorkerIconTile } from "../../my-shifts/_components/worker-cards";

export const metadata: Metadata = { title: "Credential" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

const VERSION_STATUS = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Submitted", tone: "info" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
} as const;

/**
 * The worker's own credential record (P0-E8-QA-F2): the canonical record
 * arrangement inside the worker column, like the worker timesheet record.
 * Owner-only; the reads, sharing, versions, uploads and document gate are
 * unchanged. Agency reviewer notes and other agencies' shares are never read.
 */
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
    <RecordPage>
      <PageHeader
        variant="reference"
        title={credential.typeName}
        back={
          <Link
            href={`/app/organisations/${organisationId}/my-credentials`}
            className="text-primary underline underline-offset-4"
          >
            My Credentials
          </Link>
        }
        description={
          <p className="break-words">
            {[
              credential.jurisdictionCode,
              credential.issuingAuthority,
              credential.credentialNumber ? `No. ${credential.credentialNumber}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "—"}
          </p>
        }
        meta={
          !isActive ? (
            <RefChip tone="neutral" className="font-semibold">
              Withdrawn
            </RefChip>
          ) : (
            <RecordMeta>
              {credential.versions.length === 1
                ? "1 version"
                : `${credential.versions.length} versions`}
            </RecordMeta>
          )
        }
      />

      <Panel titleId="sharing-heading" title={<>Sharing with {organisation.name}</>}>
        {activeShare ? (
          <RecordStatusBlock>
            <WorkerIconTile icon="compliance" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <RefChip tone="info" className="w-fit font-semibold">
                Shared
              </RefChip>
              <span className={RECORD_ROW_META}>
                {organisation.name} can see this credential and verify it.
              </span>
            </span>
            <div className="w-full sm:w-auto">
              <InlineActionForm
                action={revokeShareAction}
                fields={{ ...base, shareId: activeShare.id }}
                label="Stop sharing"
              />
            </div>
          </RecordStatusBlock>
        ) : isActive ? (
          <RecordStatusBlock>
            <WorkerIconTile icon="compliance" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <RefChip tone="neutral" className="w-fit font-semibold">
                Not shared
              </RefChip>
              <span className={RECORD_ROW_META}>
                {organisation.name} cannot see this credential until you share it.
              </span>
            </span>
            <div className="w-full sm:w-auto">
              <InlineActionForm
                action={shareCredentialAction}
                fields={base}
                label={`Share with ${organisation.name}`}
                variant="primary"
              />
            </div>
          </RecordStatusBlock>
        ) : (
          <RecordNote>This credential was withdrawn and is not shared.</RecordNote>
        )}
      </Panel>

      <Panel titleId="versions-heading" title={<>Versions</>}>
        <RecordList label="Credential versions">
          {credential.versions.map((version) => (
            <li key={version.id} className={`${RECORD_ROW} flex-col items-stretch`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="flex min-w-0 flex-col">
                  <span className={RECORD_ROW_TITLE}>Version {version.number}</span>
                  <span className={RECORD_ROW_META}>
                    {[
                      version.issueDate ? `Issued ${formatCalendarDate(version.issueDate)}` : null,
                      version.expiryDate
                        ? `Expires ${formatCalendarDate(version.expiryDate)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No dates recorded"}
                  </span>
                </span>
                <RefChip tone={VERSION_STATUS[version.status].tone} className="font-semibold">
                  {VERSION_STATUS[version.status].label}
                </RefChip>
              </div>
              {version.documents.length > 0 ? (
                <ul
                  aria-label={`Documents for version ${version.number}`}
                  className="flex flex-col gap-2"
                >
                  {version.documents.map((document, index) => (
                    <li key={document.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-chelth-navy">Document {index + 1}</span>
                      <DocumentStatusBadge status={document.status} />
                      {document.status === "clean" || document.status === "scanning" ? (
                        <OpenDocumentButton
                          documentId={document.id}
                          label={`Open document ${index + 1} of version ${version.number}`}
                        />
                      ) : null}
                      {document.scanFailed ? (
                        <span className={`${RECORD_ROW_META} basis-full`}>
                          We couldn&apos;t finish checking this document. Try again later or upload
                          a new copy.
                        </span>
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
                    />
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </RecordList>
        {isActive && !draft ? (
          <div className="flex flex-col gap-2">
            <h3 className={RECORD_ROW_TITLE}>Renew</h3>
            <RecordNote>A renewal adds a new version. Earlier versions are kept.</RecordNote>
            <NewVersionForm {...base} />
          </div>
        ) : null}
      </Panel>

      <Panel titleId="verification-heading" title={<>Verification by agencies</>}>
        {credential.verifications.length === 0 ? (
          <RecordNote>No agency has reviewed this credential yet.</RecordNote>
        ) : (
          <RecordList label="Agency verification">
            {credential.verifications.map((verification) => (
              <li key={verification.id} className={`${RECORD_ROW} justify-between`}>
                <span className="flex min-w-0 flex-col">
                  <span className={`${RECORD_ROW_TITLE} break-words`}>
                    {agencyName.get(verification.agencyOrganisationId) ?? "An agency"}
                  </span>
                  <span className={RECORD_ROW_META}>
                    Version{" "}
                    {credential.versions.find((version) => version.id === verification.versionId)
                      ?.number ?? "?"}
                    {verification.rejectionReason
                      ? ` · ${REJECTION_REASON_LABELS[verification.rejectionReason]}`
                      : ""}
                    {" · "}
                    <time dateTime={verification.createdAt}>
                      {dateTime.format(new Date(verification.createdAt))}
                    </time>
                  </span>
                </span>
                <VerificationBadge outcome={verification.outcome} />
              </li>
            ))}
          </RecordList>
        )}
      </Panel>

      {isActive ? (
        <Panel titleId="withdraw-heading" title={<>Withdraw</>}>
          <RecordNote>
            Withdrawing stops this credential counting anywhere. History is kept.
          </RecordNote>
          <div className="w-fit">
            <InlineActionForm
              action={withdrawCredentialAction}
              fields={base}
              label="Withdraw credential"
              variant="danger"
            />
          </div>
        </Panel>
      ) : null}
    </RecordPage>
  );
}
