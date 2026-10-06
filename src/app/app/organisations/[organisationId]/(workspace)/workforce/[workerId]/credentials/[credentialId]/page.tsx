import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RefChip } from "@/components/reference/locked-reference";
import {
  RECORD_ROW,
  RECORD_ROW_META,
  RECORD_ROW_TITLE,
  RecordList,
  RecordMeta,
  RecordNote,
  RecordPage,
} from "@/components/reference/record-page";
import { KeyValueList } from "@/components/ui/key-value-list";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SectionTabs } from "@/components/ui/section-tabs";
import { StatusChip } from "@/components/ui/status-chip";
import { getReadiness } from "@/features/compliance";
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
import {
  COMPLIANCE_REASON_LABELS,
  formatCalendarDate,
  REJECTION_REASON_LABELS,
} from "@/lib/domain/credentials";

import { complianceTone } from "../../../../compliance/_components/compliance-tones";

export const metadata: Metadata = { title: "Credential review" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

/**
 * Credential record (canonical record arrangement, CHELTH-LOCKED-VISUAL-
 * SYSTEM.md). Same reads, gates and forms as before: documents open only
 * through the audited signed-URL gate once cleared; decisions need
 * credential.verify (AAL2); only this agency's share and decisions are shown.
 */
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
  const canCompliance = can(CAPABILITIES.COMPLIANCE_VIEW) === "granted";
  const ownDecisions = credential.verifications.filter(
    (item) => item.agencyOrganisationId === organisationId,
  );
  const submitted = credential.versions.filter((version) => version.status === "submitted");
  const latestSubmitted = submitted[0];
  const latestDecision = latestSubmitted
    ? ownDecisions.find((item) => item.versionId === latestSubmitted.id)
    : undefined;
  const [facilities, readiness] = await Promise.all([
    credential.scope === "facility" && can(CAPABILITIES.FACILITY_VIEW) === "granted"
      ? listFacilities(organisationId).then((list) =>
          list.filter((facility) => facility.status !== "archived"),
        )
      : Promise.resolve(null),
    canCompliance ? getReadiness(worker.id) : Promise.resolve(null),
  ]);
  // The engine's own results for requirements this credential type can satisfy.
  const coverage =
    readiness?.items.filter((item) => item.credentialTypeKey === credential.typeKey) ?? [];
  const share = credential.shares.find(
    (item) => item.agencyOrganisationId === organisationId && item.status === "active",
  );
  const returnTo = `/app/organisations/${organisationId}/workforce/${worker.id}/credentials/${credential.id}`;
  const versionNumber = (versionId: string) =>
    credential.versions.find((version) => version.id === versionId)?.number ?? "?";

  const sections = [
    { label: "Summary", href: "#summary-heading" as Route, current: false },
    { label: "Versions", href: "#evidence-heading" as Route, current: false },
    { label: "Verification", href: "#verification-heading" as Route, current: false },
    ...(canCompliance
      ? [{ label: "Requirements", href: "#coverage-heading" as Route, current: false }]
      : []),
    { label: "Sharing and history", href: "#history-heading" as Route, current: false },
  ];

  return (
    // Locked inner-page system (docs/ui-reference/CHELTH-LOCKED-VISUAL-SYSTEM.md).
    <RecordPage>
      <PageHeader
        variant="reference"
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
          <p>
            {[credential.jurisdictionCode, credential.issuingAuthority]
              .filter(Boolean)
              .join(" · ") || "—"}
            {credential.credentialNumber ? ` · No. ${credential.credentialNumber}` : ""}
          </p>
        }
        meta={
          <>
            {credential.status === "withdrawn" ? (
              <StatusChip tone="neutral">Withdrawn by the worker</StatusChip>
            ) : (
              <VerificationBadge outcome={latestDecision?.outcome ?? null} />
            )}
            <RecordMeta>
              {latestSubmitted
                ? `Version ${latestSubmitted.number} is current`
                : "Nothing submitted yet"}
            </RecordMeta>
          </>
        }
      />

      <SectionTabs label="Credential record sections" tabs={sections} />

      {review === "step_up_required" || verify === "step_up_required" ? (
        <StepUpNotice returnTo={returnTo}>
          Opening documents and recording decisions require verification with your authenticator
          app.
        </StepUpNotice>
      ) : null}

      <Panel titleId="summary-heading" title={<>Summary</>}>
        <KeyValueList
          className="max-w-2xl"
          items={[
            {
              label: "Holder",
              value: (
                <Link
                  href={`/app/organisations/${organisationId}/workforce/${worker.id}`}
                  className="text-primary underline underline-offset-4"
                >
                  {worker.displayName ?? "Worker"}
                </Link>
              ),
            },
            { label: "Credential", value: credential.typeName },
            {
              label: "Status",
              value: credential.status === "withdrawn" ? "Withdrawn by the worker" : "Active",
            },
            { label: "Jurisdiction", value: credential.jurisdictionCode ?? "—" },
            { label: "Issuing authority", value: credential.issuingAuthority ?? "—" },
            ...(credential.credentialNumber
              ? [{ label: "Credential number", value: credential.credentialNumber }]
              : []),
            {
              label: "Issued",
              value: latestSubmitted?.issueDate
                ? formatCalendarDate(latestSubmitted.issueDate)
                : "—",
            },
            {
              label: "Expires",
              value: latestSubmitted?.expiryDate
                ? formatCalendarDate(latestSubmitted.expiryDate)
                : "—",
            },
            {
              label: "Verification",
              value: <VerificationBadge outcome={latestDecision?.outcome ?? null} />,
            },
          ]}
        />
      </Panel>

      <Panel titleId="evidence-heading" title={<>Versions and documents</>}>
        {submitted.length === 0 ? (
          <RecordNote>Nothing has been submitted for review yet.</RecordNote>
        ) : (
          <>
            <RecordNote>
              Versions are kept as submitted; a new version never overwrites an earlier one.
              Documents open only after the security scan clears them.
            </RecordNote>
            <RecordList label="Credential versions">
              {submitted.map((version, versionIndex) => {
                const decision = ownDecisions.find((item) => item.versionId === version.id);
                return (
                  <li key={version.id} className={`${RECORD_ROW} flex-col items-stretch`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex min-w-0 flex-col">
                        <span className={RECORD_ROW_TITLE}>
                          Version {version.number}
                          <span className="font-normal text-slate-600">
                            {versionIndex === 0 ? " · Current" : " · Earlier version"}
                          </span>
                        </span>
                        <span className={RECORD_ROW_META}>
                          {[
                            version.issueDate
                              ? `Issued ${formatCalendarDate(version.issueDate)}`
                              : null,
                            version.expiryDate
                              ? `Expires ${formatCalendarDate(version.expiryDate)}`
                              : null,
                            version.submittedAt
                              ? `Submitted ${dateTime.format(new Date(version.submittedAt))}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </span>
                      </span>
                      <VerificationBadge outcome={decision?.outcome ?? null} />
                    </div>
                    <ul className="flex flex-col gap-2">
                      {version.documents.map((document, index) => (
                        <li key={document.id} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-medium text-chelth-navy">Document {index + 1}</span>
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
                      {version.documents.length === 0 ? (
                        <li className={RECORD_ROW_META}>
                          {/* Document rows are readable only with credential.review at AAL2. */}
                          {review === "granted"
                            ? "No document attached."
                            : "Documents are listed for reviewers after verification with an authenticator app."}
                        </li>
                      ) : null}
                    </ul>
                  </li>
                );
              })}
            </RecordList>
          </>
        )}
      </Panel>

      <Panel titleId="verification-heading" title={<>Verification</>}>
        {verify === "granted" && latestSubmitted && credential.status === "active" ? (
          <VerificationForm
            organisationId={organisationId}
            workerId={worker.id}
            credentialId={credential.id}
            versionId={latestSubmitted.id}
            versionLabel={`version ${latestSubmitted.number}`}
            facilities={facilities ? facilities.map(({ id, name }) => ({ id, name })) : null}
          />
        ) : (
          <RecordNote>
            {credential.status === "withdrawn"
              ? "The worker withdrew this credential; no decision can be recorded."
              : !latestSubmitted
                ? "A decision can be recorded once a version is submitted."
                : verify === "step_up_required"
                  ? "Verify with your authenticator app to record a decision."
                  : latestDecision
                    ? "Your agency's latest decision is shown in the history below."
                    : "Waiting for a reviewer with verification access."}
          </RecordNote>
        )}
      </Panel>

      {canCompliance ? (
        <Panel titleId="coverage-heading" title={<>Requirement coverage</>}>
          {coverage.length === 0 ? (
            <RecordNote>
              No {organisation.name} baseline requirement uses this credential.
            </RecordNote>
          ) : (
            <RecordList label="Requirement coverage">
              {coverage.map((item, index) => (
                <li key={`${item.requirementId ?? "item"}-${index}`} className={RECORD_ROW}>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={RECORD_ROW_TITLE}>
                      {item.credentialTypeName ?? credential.typeName}
                    </span>
                    <span className={RECORD_ROW_META}>
                      {item.scope === "facility" ? "Facility requirement" : "Agency baseline"}
                      {item.effectiveExpiryDate
                        ? ` · Valid to ${formatCalendarDate(item.effectiveExpiryDate)}`
                        : ""}
                    </span>
                  </span>
                  <RefChip tone={complianceTone(item.reason)} className="font-semibold">
                    {COMPLIANCE_REASON_LABELS[item.reason]}
                  </RefChip>
                </li>
              ))}
            </RecordList>
          )}
          <RecordNote>
            Results come from the readiness engine; facility requirements are checked on the worker
            record.
          </RecordNote>
        </Panel>
      ) : null}

      <Panel titleId="history-heading" title={<>Sharing and history</>}>
        <RecordNote>
          {share
            ? `Shared with ${organisation.name} since ${dateTime.format(new Date(share.sharedAt))}.`
            : `Not currently shared with ${organisation.name}.`}
        </RecordNote>
        <h3 className={RECORD_ROW_TITLE}>{organisation.name} decision history</h3>
        {ownDecisions.length === 0 ? (
          <RecordNote>No decisions recorded.</RecordNote>
        ) : (
          <RecordList label="Decision history">
            {ownDecisions.map((decision) => (
              <li key={decision.id} className={`${RECORD_ROW} justify-between`}>
                <span className="flex min-w-0 flex-col">
                  <span className={RECORD_ROW_TITLE}>
                    Version {versionNumber(decision.versionId)}
                  </span>
                  {decision.rejectionReason ? (
                    <span className={RECORD_ROW_META}>
                      {REJECTION_REASON_LABELS[decision.rejectionReason]}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-2">
                  <VerificationBadge outcome={decision.outcome} />
                  <time dateTime={decision.createdAt} className="text-sm text-slate-600">
                    {dateTime.format(new Date(decision.createdAt))}
                  </time>
                </span>
              </li>
            ))}
          </RecordList>
        )}
      </Panel>
    </RecordPage>
  );
}
