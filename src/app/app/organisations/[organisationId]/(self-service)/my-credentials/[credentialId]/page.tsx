import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { REF_TEXT, RefChip } from "@/components/reference/locked-reference";
import {
  RECORD_ROW,
  RECORD_ROW_META,
  RECORD_ROW_TITLE,
  RecordList,
  RecordMeta,
  RecordPage,
} from "@/components/reference/record-page";
import { PageHeader } from "@/components/ui/page-header";
import {
  credentialIdSchema,
  EvidenceUploader,
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

import { StatePanel, WorkerIconTile } from "../../my-shifts/_components/worker-cards";
import {
  credentialState,
  CredentialSteps,
  EVIDENCE_COPY,
  evidenceState,
  SummaryRows,
  WorkerCardSection,
} from "../_components/credential-view";
import { RefreshWhileChecking } from "../_components/refresh-while-checking";

export const metadata: Metadata = { title: "Credential" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

const VERSION_STATUS = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Submitted", tone: "info" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
} as const;

/** Document states in worker language (no scanner or storage vocabulary). */
const WORKER_DOCUMENT_STATUS = {
  upload_pending: { label: "Upload didn't finish", tone: "neutral" },
  scanning: { label: "Checking", tone: "info" },
  clean: { label: "Ready", tone: "success" },
  rejected: { label: "Cannot be used", tone: "danger" },
  quarantined: { label: "Cannot be used", tone: "danger" },
} as const;

/** Worker 48 px full-width action buttons (the W1 CTA height) inside InlineActionForm. */
const FULL_ACTION = "h-12 w-full rounded-[8px] text-[15px] sm:h-12";

/**
 * The worker's own credential record (P0-E9-3C worker-mobile recomposition):
 * state and expiry first, then what the worker can do next — evidence and
 * review while a draft is open — then sharing, the agency's review, a compact
 * history and the danger zone. Owner-only; reads, sharing, versions, uploads,
 * the scanner gate and the document access gate are unchanged.
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
  const isActive = credential.status === "active";
  const draft = isActive
    ? credential.versions.find((version) => version.status === "draft")
    : undefined;
  const latest = credential.versions[0];
  const current = draft ?? latest;
  const base = { organisationId, credentialId: credential.id };

  // This agency's latest decision on the latest submitted version (newest first).
  const latestSubmitted = credential.versions.find((version) => version.status === "submitted");
  const agencyReview = latestSubmitted
    ? credential.verifications.find(
        (verification) =>
          verification.agencyOrganisationId === organisationId &&
          verification.versionId === latestSubmitted.id,
      )
    : undefined;
  const otherReviews = credential.verifications.filter(
    (verification) => verification.agencyOrganisationId !== organisationId,
  );
  const state = credentialState({
    status: credential.status,
    latestVersionStatus: latest?.status ?? null,
    agencyOutcome: agencyReview?.outcome ?? null,
  });

  const evidence = evidenceState(current?.documents ?? []);
  const hasStoredEvidence = (current?.documents ?? []).some(
    (document) => document.status === "scanning" || document.status === "clean",
  );
  const readyToSubmit = !credential.requiresDocument || hasStoredEvidence;
  const checkingIds = credential.versions.flatMap((version) =>
    version.documents.filter((document) => document.status === "scanning").map(({ id }) => id),
  );
  const visibleIds = credential.versions.flatMap((version) =>
    version.documents.map(({ id }) => id),
  );
  const expiry = current?.expiryDate;

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
          [
            credential.jurisdictionCode,
            credential.issuingAuthority,
            credential.credentialNumber ? `No. ${credential.credentialNumber}` : null,
          ].some(Boolean) ? (
            <p className="break-words">
              {[
                credential.jurisdictionCode,
                credential.issuingAuthority,
                credential.credentialNumber ? `No. ${credential.credentialNumber}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : undefined
        }
        meta={
          <>
            <RefChip tone={state.tone} className="font-semibold">
              {state.label}
            </RefChip>
            <RecordMeta>
              {expiry ? `Expires ${formatCalendarDate(expiry)}` : "No expiry date"}
            </RecordMeta>
          </>
        }
      />

      {draft ? (
        <>
          <CredentialSteps current={readyToSubmit ? 3 : 2} />
          <WorkerCardSection
            id="evidence-heading"
            title="Evidence"
            note={
              credential.requiresDocument
                ? "A clear copy of your certificate or licence."
                : "No document is needed for this credential."
            }
          >
            {credential.requiresDocument ? (
              <>
                <RefreshWhileChecking checkingIds={checkingIds} visibleIds={visibleIds} />
                {evidence.state !== "none" ? (
                  <EvidenceStatus
                    state={evidence.state}
                    documentId={evidence.latest?.id}
                    openLabel={`Open document for version ${draft.number}`}
                  />
                ) : null}
                <EvidenceUploader
                  versionId={draft.id}
                  replacing={evidence.state !== "none"}
                  checkingIds={checkingIds}
                />
              </>
            ) : null}
          </WorkerCardSection>

          <WorkerCardSection
            id="review-heading"
            title="Review and submit"
            note={`Check the details, then send them to ${organisation.name} for review.`}
          >
            <SummaryRows
              rows={[
                { label: "Credential", value: credential.typeName },
                ...(credential.issuingAuthority
                  ? [{ label: "Issuing body", value: credential.issuingAuthority }]
                  : []),
                {
                  label: "Issued",
                  value: draft.issueDate ? formatCalendarDate(draft.issueDate) : "Not recorded",
                },
                {
                  label: "Expires",
                  value: draft.expiryDate ? formatCalendarDate(draft.expiryDate) : "No expiry date",
                },
                ...(credential.requiresDocument
                  ? [{ label: "Evidence", value: EVIDENCE_COPY[evidence.state].title }]
                  : []),
                {
                  label: "Sharing",
                  value: activeShare ? `Shared with ${organisation.name}` : "Not shared",
                },
              ]}
            />
            {readyToSubmit ? (
              <InlineActionForm
                action={submitVersionAction}
                fields={{ ...base, versionId: draft.id }}
                label="Submit for review"
                variant="primary"
                buttonClassName={FULL_ACTION}
              />
            ) : (
              <StatePanel tone="info" title="Add evidence to continue.">
                <p className="text-slate-700">
                  Upload your document above, then submit it for review.
                </p>
              </StatePanel>
            )}
            <InlineActionForm
              action={withdrawVersionAction}
              fields={{ ...base, versionId: draft.id }}
              label="Discard draft"
              buttonClassName={FULL_ACTION}
            />
          </WorkerCardSection>
        </>
      ) : credential.requiresDocument && current ? (
        <WorkerCardSection id="evidence-heading" title="Evidence">
          <RefreshWhileChecking checkingIds={checkingIds} visibleIds={visibleIds} />
          <EvidenceStatus
            state={evidence.state}
            documentId={evidence.latest?.id}
            openLabel={`Open document for version ${current.number}`}
          />
        </WorkerCardSection>
      ) : null}

      <WorkerCardSection id="sharing-heading" title={<>Sharing with {organisation.name}</>}>
        {activeShare ? (
          <>
            <ShareState
              shared
              text={`${organisation.name} can see this credential and verify it.`}
            />
            <InlineActionForm
              action={revokeShareAction}
              fields={{ ...base, shareId: activeShare.id }}
              label="Stop sharing"
              buttonClassName={FULL_ACTION}
            />
          </>
        ) : isActive ? (
          <>
            <ShareState
              shared={false}
              text={`${organisation.name} cannot see this credential until you share it.`}
            />
            <InlineActionForm
              action={shareCredentialAction}
              fields={base}
              label={`Share with ${organisation.name}`}
              variant={draft ? "outline" : "primary"}
              buttonClassName={FULL_ACTION}
            />
          </>
        ) : (
          <p className={RECORD_ROW_META}>This credential was withdrawn and is not shared.</p>
        )}
      </WorkerCardSection>

      <WorkerCardSection id="verification-heading" title={<>Review by {organisation.name}</>}>
        {agencyReview ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={RECORD_ROW_META}>
              Version {latestSubmitted?.number}
              {agencyReview.rejectionReason
                ? ` · ${REJECTION_REASON_LABELS[agencyReview.rejectionReason]}`
                : ""}
              {" · "}
              <time dateTime={agencyReview.createdAt}>
                {dateTime.format(new Date(agencyReview.createdAt))}
              </time>
            </span>
            <VerificationBadge outcome={agencyReview.outcome} />
          </div>
        ) : (
          <p className={RECORD_ROW_META}>
            {latestSubmitted
              ? `Waiting for ${organisation.name} to review it.`
              : "Not submitted for review yet."}
          </p>
        )}
        {otherReviews.length > 0 ? (
          <RecordList label="Agency verification">
            {otherReviews.map((verification) => (
              <li key={verification.id} className={`${RECORD_ROW} justify-between`}>
                <span className="flex min-w-0 flex-col">
                  <span className={`${RECORD_ROW_TITLE} break-words`}>
                    {agencyName.get(verification.agencyOrganisationId) ?? "An agency"}
                  </span>
                  <span className={RECORD_ROW_META}>
                    <time dateTime={verification.createdAt}>
                      {dateTime.format(new Date(verification.createdAt))}
                    </time>
                  </span>
                </span>
                <VerificationBadge outcome={verification.outcome} />
              </li>
            ))}
          </RecordList>
        ) : null}
      </WorkerCardSection>

      {isActive && !draft ? (
        <WorkerCardSection
          id="renew-heading"
          title="Renew"
          note="A renewal adds a new version with new dates. Earlier versions are kept."
        >
          <NewVersionForm {...base} />
        </WorkerCardSection>
      ) : null}

      <details className="group rounded-[14px] border border-[rgba(18,107,103,0.10)] bg-white/70">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-[15px] font-semibold text-chelth-navy [&::-webkit-details-marker]:hidden">
          <span>
            History
            <span className="font-medium text-slate-600">
              {" · "}
              {credential.versions.length === 1
                ? "1 version"
                : `${credential.versions.length} versions`}
            </span>
          </span>
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-5 text-slate-500 transition-transform group-open:rotate-180"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div className="px-3 pb-3">
          <RecordList label="Credential versions">
            {credential.versions.map((version) => (
              <li key={version.id} className={`${RECORD_ROW} flex-col items-stretch`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="flex min-w-0 flex-col">
                    <span className={RECORD_ROW_TITLE}>Version {version.number}</span>
                    <span className={RECORD_ROW_META}>
                      {[
                        version.issueDate
                          ? `Issued ${formatCalendarDate(version.issueDate)}`
                          : null,
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
                        <RefChip
                          tone={WORKER_DOCUMENT_STATUS[document.status].tone}
                          className="font-semibold"
                        >
                          {WORKER_DOCUMENT_STATUS[document.status].label}
                        </RefChip>
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
              </li>
            ))}
          </RecordList>
        </div>
      </details>

      {isActive ? (
        <section
          aria-labelledby="withdraw-heading"
          className="flex flex-col gap-3 rounded-[14px] border border-[rgba(180,35,24,0.16)] bg-white p-4"
        >
          <div className="flex flex-col gap-0.5">
            <h2 id="withdraw-heading" className={REF_TEXT.panelTitle}>
              Withdraw
            </h2>
            <p className={RECORD_ROW_META}>
              Withdrawing stops this credential counting anywhere. History is kept.
            </p>
          </div>
          <InlineActionForm
            action={withdrawCredentialAction}
            fields={base}
            label="Withdraw credential"
            variant="danger"
            buttonClassName={FULL_ACTION}
          />
        </section>
      ) : null}
    </RecordPage>
  );
}

function EvidenceStatus({
  state,
  documentId,
  openLabel,
}: {
  state: ReturnType<typeof evidenceState>["state"];
  documentId: string | undefined;
  openLabel: string;
}) {
  const copy = EVIDENCE_COPY[state];
  const openable =
    documentId && (state === "ready" || state === "checking" || state === "retrying");
  return (
    <div className="flex flex-col gap-2">
      <div role="status">
        <StatePanel tone={copy.tone} title={copy.title}>
          <p className="text-slate-700">{copy.note}</p>
        </StatePanel>
      </div>
      {openable ? (
        <div className="w-full [&_button]:h-12 [&_button]:w-full [&_button]:rounded-[8px] [&_button]:text-[15px] [&_button]:sm:h-12">
          <OpenDocumentButton documentId={documentId} label={openLabel} />
        </div>
      ) : null}
    </div>
  );
}

function ShareState({ shared, text }: { shared: boolean; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <WorkerIconTile icon="compliance" />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <RefChip tone={shared ? "info" : "neutral"} className="w-fit font-semibold">
          {shared ? "Shared" : "Not shared"}
        </RefChip>
        <span className={RECORD_ROW_META}>{text}</span>
      </span>
    </div>
  );
}
