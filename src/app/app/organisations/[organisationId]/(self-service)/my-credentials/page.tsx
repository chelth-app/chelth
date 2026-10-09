import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { REF_TEXT, RefChip } from "@/components/reference/locked-reference";
import { PageHeader } from "@/components/ui/page-header";
import { getReadiness, ReadinessBadge } from "@/features/compliance";
import { listMyCredentials } from "@/features/credentials";
import { loadOrganisationPage } from "@/features/organisations";
import { getMyWorkerRecord } from "@/features/workforce";
import { COMPLIANCE_REASON_LABELS, formatCalendarDate } from "@/lib/domain/credentials";
import { cn } from "@/lib/utils/cn";

import { complianceTone } from "../../(workspace)/compliance/_components/compliance-tones";
import {
  FactRows,
  INK,
  WORKER_CARD,
  WORKER_PRIMARY_CTA,
  WorkerEmpty,
  WorkerIconTile,
} from "../my-shifts/_components/worker-cards";
import { credentialState } from "./_components/credential-view";

export const metadata: Metadata = { title: "My Credentials" };

/**
 * The worker's own credential area in the context of one agency (P0-E8-QA-F2,
 * recomposed for worker mobile in P0-E9-3C): readiness, then one card per
 * credential with its state, sharing and expiry. Adding a credential is its
 * own step-by-step page. Credentials belong to the person; nothing here
 * recomputes readiness.
 */
export default async function MyCredentialsPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/my-credentials">) {
  const { organisationId, organisation } = await loadOrganisationPage(
    (await params).organisationId,
  );
  const worker = await getMyWorkerRecord(organisationId);
  if (!worker) notFound();

  const [credentials, readiness] = await Promise.all([
    listMyCredentials(organisationId),
    getReadiness(worker.id),
  ]);
  const addHref = `/app/organisations/${organisationId}/my-credentials/new` as Route;
  // Engine order is kept within each group: what needs attention first, then what is met.
  const readinessItems = [
    ...readiness.items.filter((item) => item.severity !== "ok"),
    ...readiness.items.filter((item) => item.severity === "ok"),
  ];

  return (
    <div className="chelth-locked flex flex-col gap-6">
      <PageHeader
        variant="reference"
        title="My Credentials"
        description={
          <p>
            Your credentials belong to you. {organisation.name} sees one only while you share it.
          </p>
        }
        primaryAction={
          <Link href={addHref} className={cn(WORKER_PRIMARY_CTA, "gap-2 sm:w-auto")}>
            <span aria-hidden="true" className="text-[20px] leading-none font-normal">
              +
            </span>
            Add credential
          </Link>
        }
      />

      <section aria-labelledby="my-readiness" className={WORKER_CARD}>
        <div className="flex items-start gap-3">
          <WorkerIconTile icon="compliance" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id="my-readiness" className={REF_TEXT.panelTitle}>
              Readiness at {organisation.name}
            </h2>
            <p className="text-[13px] leading-[18px] text-slate-600">
              From {organisation.name}&apos;s credential requirements.
            </p>
            <div className="mt-0.5 flex flex-wrap gap-1.5">
              <ReadinessBadge status={readiness.status} />
            </div>
          </div>
        </div>
        {readinessItems.length === 0 ? (
          <p className="text-[13px] leading-[18px] text-slate-600">
            No credential requirements apply.
          </p>
        ) : (
          <ul
            aria-label="Readiness requirements"
            className="flex flex-col divide-y divide-[rgba(18,107,103,0.12)] border-t border-[rgba(18,107,103,0.12)]"
          >
            {readinessItems.map((item, index) => (
              <li
                key={`${item.requirementId ?? item.reason}-${index}`}
                className="flex flex-col gap-1.5 py-3 last:pb-0"
              >
                <span className={cn("text-[15px] leading-5 font-semibold break-words", INK)}>
                  {item.credentialTypeName ?? "Worker"}
                </span>
                {item.effectiveExpiryDate || item.scope === "facility" ? (
                  <span className="text-[13px] leading-[18px] text-slate-600">
                    {[
                      item.effectiveExpiryDate
                        ? `${item.severity === "ok" ? "Valid to" : "Expires"} ${formatCalendarDate(item.effectiveExpiryDate)}`
                        : null,
                      item.scope === "facility" ? "Facility requirement" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
                <RefChip tone={complianceTone(item.reason)} className="w-fit font-semibold">
                  {COMPLIANCE_REASON_LABELS[item.reason]}
                </RefChip>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="my-credentials-heading" className="flex flex-col gap-3">
        <h2 id="my-credentials-heading" className={REF_TEXT.panelTitle}>
          Credentials
        </h2>
        {credentials.length === 0 ? (
          <WorkerEmpty
            icon="compliance"
            title="No credentials yet."
            note="Add your licences and certificates to keep your readiness up to date."
          />
        ) : (
          <ul aria-label="My credentials" className="flex flex-col gap-3">
            {credentials.map((credential) => {
              const name = `${credential.typeName}${
                credential.jurisdictionCode ? ` (${credential.jurisdictionCode})` : ""
              }`;
              const expiry = credential.latestVersion?.expiryDate;
              const state = credentialState({
                status: credential.status,
                latestVersionStatus: credential.latestVersion?.status ?? null,
                agencyOutcome: credential.latestVersion?.agencyOutcome ?? null,
              });
              return (
                <li key={credential.id} className={cn(WORKER_CARD, "relative")}>
                  <div className="flex items-start gap-3">
                    <WorkerIconTile icon="compliance" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      {/* The whole card opens the record; the link keeps the credential's name. */}
                      <Link
                        href={
                          `/app/organisations/${organisationId}/my-credentials/${credential.id}` as Route
                        }
                        className={cn(
                          "text-[16px] leading-[22px] font-semibold break-words underline-offset-4 after:absolute after:inset-0 after:rounded-[14px] after:content-[''] hover:underline",
                          INK,
                        )}
                      >
                        {name}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap gap-1.5">
                        <RefChip tone={state.tone} className="font-semibold">
                          {state.label}
                        </RefChip>
                        {credential.status !== "withdrawn" ? (
                          <RefChip
                            tone={credential.sharedWithAgency ? "info" : "neutral"}
                            className="max-w-full font-semibold whitespace-normal"
                          >
                            {credential.sharedWithAgency
                              ? `Shared with ${organisation.name}`
                              : "Not shared"}
                          </RefChip>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <FactRows
                    rows={[
                      {
                        icon: "shifts",
                        label: "Expiry",
                        value: expiry
                          ? `Expires ${formatCalendarDate(expiry)}`
                          : "No expiry date recorded",
                      },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
