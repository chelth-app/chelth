import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { DetailsTabs } from "@/components/reference/details-tabs";
import { InitialsAvatar, RefChip } from "@/components/reference/locked-reference";
import { type KeyValueItem, KeyValueList } from "@/components/ui/key-value-list";
import type { StatusTone } from "@/components/ui/status-chip";
import type { ComplianceItem } from "@/features/compliance";
import type { AgencyWorkerCredential } from "@/features/credentials";
import {
  COMPLIANCE_REASON_LABELS,
  formatCalendarDate,
  VERIFICATION_LABELS,
} from "@/lib/domain/credentials";
import { cn } from "@/lib/utils/cn";

import { complianceTone, VERIFICATION_TONE } from "./compliance-tones";

/*
 * Credential Details — the canonical Chelth drawer (CHELTH-LOCKED-VISUAL-
 * SYSTEM.md, C and "Canonical Timesheets Implementation") with one readiness
 * result. Every state comes from the readiness engine and the agency's own
 * credential projection; documents never open here (the record gates them).
 */

const INK = "text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]";

const VERSION_LABELS = { draft: "Draft", submitted: "Submitted", withdrawn: "Withdrawn" } as const;

function Section({
  id,
  title,
  children,
  divided = true,
}: {
  id: string;
  title: string;
  children: ReactNode;
  divided?: boolean;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "flex flex-col gap-2.5 py-3.5",
        divided && "border-t border-[rgba(18,107,103,0.12)]",
      )}
    >
      <h3 id={id} className={cn("text-[16px] leading-[22px] font-semibold", INK)}>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Canonical record-page label/value hierarchy (as Timesheet Details). */
function Facts({ items }: { items: KeyValueItem[] }) {
  return (
    <KeyValueList
      items={items}
      className="sm:grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] sm:gap-x-5"
    />
  );
}

/** Soft verification tile (locked Timesheets treatment): semantic glyph, title, note. */
function StateTile({ tone, title, note }: { tone: StatusTone; title: string; note: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[10px] border px-3.5 py-3",
        tone === "success"
          ? "border-[rgba(18,107,103,0.07)] bg-[#f8fcfb]"
          : "border-[rgba(13,47,66,0.07)] bg-surface-muted/60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-white",
          tone === "success"
            ? "bg-success-indicator"
            : tone === "danger"
              ? "bg-danger-indicator"
              : tone === "warning"
                ? "bg-warning-indicator"
                : tone === "info"
                  ? "bg-info-indicator"
                  : "bg-neutral-indicator",
        )}
      >
        <svg
          viewBox="0 0 16 16"
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
        >
          {tone === "success" ? (
            <path d="m4 8.5 2.5 2.5L12 5.5" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M8 4.5v4.5M8 11.5v.01" strokeLinecap="round" />
          )}
        </svg>
      </span>
      <span className="flex flex-col">
        <span className="text-[14px] leading-5 font-medium text-chelth-navy">{title}</span>
        <span className="text-[12.5px] leading-[18px] text-slate-600">{note}</span>
      </span>
    </div>
  );
}

/** "In 365 days" / "Expired 3 days ago" for a calendar expiry date. */
export function expiryNote(daysLeft: number): string {
  if (daysLeft < 0) return `Expired ${-daysLeft} ${daysLeft === -1 ? "day" : "days"} ago`;
  if (daysLeft === 0) return "Expires today";
  return `${daysLeft} ${daysLeft === 1 ? "day" : "days"} remaining`;
}

export function CredentialDetailsPanel({
  id,
  workerName,
  roles,
  item,
  scopeLabel,
  credential,
  daysLeft,
  coverage,
  credentialHref,
  workerHref,
}: {
  id: string;
  workerName: string | null;
  roles: string[];
  item: ComplianceItem;
  scopeLabel: string;
  /** The agency's projection of the matching credential, when one is shared. */
  credential: AgencyWorkerCredential | null;
  daysLeft: number | null;
  /** Every engine result for this worker in the same evaluation. */
  coverage: ComplianceItem[];
  /** credential.view holders, when a credential exists. */
  credentialHref: Route | null;
  workerHref: Route;
}) {
  const worker = workerName ?? "Worker";
  const tone = complianceTone(item.reason);
  const title = item.credentialTypeName ?? COMPLIANCE_REASON_LABELS[item.reason];
  const statusChip = (
    <RefChip tone={tone} className="font-semibold">
      {COMPLIANCE_REASON_LABELS[item.reason]}
    </RefChip>
  );

  const details = (
    <Section id={`${id}-details`} title="Credential Details" divided={false}>
      <Facts
        items={[
          { label: "Credential", value: title },
          { label: "Status", value: statusChip },
          { label: "Requirement", value: scopeLabel },
          ...(credential?.jurisdictionCode
            ? [{ label: "Jurisdiction", value: credential.jurisdictionCode }]
            : []),
          {
            label: "Expiration date",
            value: item.effectiveExpiryDate ? formatCalendarDate(item.effectiveExpiryDate) : "—",
          },
          ...(credential?.latestVersionNumber
            ? [
                {
                  label: "Latest version",
                  value: `Version ${credential.latestVersionNumber}${
                    credential.latestVersionStatus
                      ? ` · ${VERSION_LABELS[credential.latestVersionStatus]}`
                      : ""
                  }`,
                },
              ]
            : []),
        ]}
      />
    </Section>
  );

  const document = (
    <Section id={`${id}-document`} title="Credential Document">
      {!credential ? (
        <StateTile
          tone="neutral"
          title="No credential on file"
          note="The worker has not shared a credential for this requirement."
        />
      ) : credential.documentsCleared ? (
        <StateTile
          tone="success"
          title="Document cleared"
          note="The security scan has cleared this evidence. Documents open from the credential record, where access is audited."
        />
      ) : (
        <StateTile
          tone="info"
          title="Document not cleared"
          note="Evidence waiting for, or failing, the security scan is never treated as verified."
        />
      )}
    </Section>
  );

  const verification = (
    <Section id={`${id}-verification`} title="Verification">
      {credential?.agencyVerification ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <RefChip
            tone={VERIFICATION_TONE[credential.agencyVerification]}
            className="font-semibold"
          >
            {VERIFICATION_LABELS[credential.agencyVerification]}
          </RefChip>
          <span className="text-[13px] text-slate-600">Your agency&apos;s latest decision</span>
        </div>
      ) : (
        <p className="text-[13.5px] leading-5 font-medium text-slate-600">
          {credential ? "Not reviewed by your agency yet." : "Nothing to verify yet."}
        </p>
      )}
    </Section>
  );

  const expiration =
    daysLeft !== null ? (
      <Section id={`${id}-expiration`} title="Expiration">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[linear-gradient(145deg,#e6f9f3,#ccefe3)] text-chelth-teal-dark [&>svg]:size-[18px]"
          >
            <WorkspaceNavIcon name="shifts" strokeWidth={2.1} />
          </span>
          <span className="flex flex-col">
            <span
              className={cn(
                "text-[14px] leading-5 font-medium",
                daysLeft < 0
                  ? "text-danger-soft-foreground"
                  : item.reason === "EXPIRING_SOON"
                    ? "text-warning-soft-foreground"
                    : "text-chelth-navy",
              )}
            >
              {expiryNote(daysLeft)}
            </span>
            <span className="text-[12.5px] leading-[18px] text-slate-600">
              Valid to {formatCalendarDate(item.effectiveExpiryDate ?? "")}
            </span>
          </span>
        </div>
      </Section>
    ) : null;

  const requirements = (
    <Section id={`${id}-coverage`} title="Requirement Coverage" divided={false}>
      {coverage.length === 0 ? (
        <p className="text-[13.5px] font-medium text-slate-600">No requirements apply.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[rgba(18,107,103,0.10)]">
          {coverage.map((entry, index) => (
            <li
              key={`${entry.requirementId ?? entry.credentialTypeKey ?? "item"}-${index}`}
              className="flex min-h-[48px] items-center gap-3 py-1.5"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("line-clamp-2 text-[14px] leading-5 font-medium", INK)}>
                  {entry.credentialTypeName ?? "Worker requirement"}
                </span>
                <span className="text-[12.5px] leading-[18px] text-slate-600">
                  {entry.scope === "facility" ? "Facility requirement" : "Agency requirement"}
                </span>
              </span>
              <RefChip tone={complianceTone(entry.reason)} className="font-semibold">
                {COMPLIANCE_REASON_LABELS[entry.reason]}
              </RefChip>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );

  const tabs = [
    {
      id: "overview",
      label: "Overview",
      content: (
        <div className="flex flex-col">
          {details}
          {document}
          {verification}
          {expiration}
        </div>
      ),
    },
    { id: "requirements", label: "Requirements", content: requirements },
  ];

  return (
    <div className="flex min-h-full flex-col text-[13.5px] leading-5">
      <div className="flex items-start gap-4 pt-1">
        <span className="rounded-full shadow-[0_6px_16px_rgba(0,90,96,0.18)] ring-4 ring-white">
          <InitialsAvatar name={workerName} size={84} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col pt-2">
          <div className="flex items-start justify-between gap-2">
            <p
              className={cn(
                "font-display text-[21px] leading-[27px] font-bold tracking-[-0.02em]",
                INK,
              )}
            >
              {worker}
            </p>
            <RefChip tone={tone} className="mt-0.5 h-7 shrink-0 px-3 text-[12.5px] font-semibold">
              {COMPLIANCE_REASON_LABELS[item.reason]}
            </RefChip>
          </div>
          <p className="truncate text-[14px] leading-[22px] font-medium text-slate-600">{title}</p>
          <p className="truncate text-[13px] leading-5 text-muted-foreground">
            {roles.length > 0 ? roles.join(", ") : "No discipline recorded"}
          </p>
        </div>
      </div>

      <dl className="mt-4 flex flex-col gap-1 text-[14px] text-slate-600">
        <div className="flex min-h-7 items-center gap-3">
          <dt className="flex w-5 justify-center text-chelth-teal-dark [&>svg]:size-[18px]">
            <WorkspaceNavIcon name="compliance" strokeWidth={2.1} />
            <span className="sr-only">Requirement</span>
          </dt>
          <dd className="truncate">{scopeLabel}</dd>
        </div>
        <div className="flex min-h-7 items-center gap-3">
          <dt className="flex w-5 justify-center text-chelth-teal-dark [&>svg]:size-[18px]">
            <WorkspaceNavIcon name="shifts" strokeWidth={2.1} />
            <span className="sr-only">Expiration</span>
          </dt>
          <dd className="truncate">
            {item.effectiveExpiryDate
              ? `Valid to ${formatCalendarDate(item.effectiveExpiryDate)}`
              : "No expiry on file"}
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <DetailsTabs label={`${worker} ${title}`} tabs={tabs} />
      </div>

      {/* Locked action region: review happens on the credential record. */}
      <div className="mt-auto flex flex-col gap-2.5 pt-4">
        {credentialHref ? (
          <Link
            href={credentialHref}
            className="inline-flex h-12 items-center justify-center gap-2.5 rounded-[8px] bg-[linear-gradient(180deg,#00666c,#004f55)] text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_14px_-4px_rgba(0,58,64,0.45)] transition-[filter] hover:brightness-110"
          >
            <WorkspaceNavIcon name="compliance" strokeWidth={2.1} className="size-5" />
            Review Credential
          </Link>
        ) : null}
        <Link
          href={workerHref}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-[rgba(0,90,96,0.35)] bg-white text-[14px] font-semibold text-chelth-navy shadow-[0_1px_2px_rgba(13,47,66,0.05)] hover:border-chelth-teal-dark hover:bg-[#f4fbf9]"
        >
          <WorkspaceNavIcon
            name="workforce"
            strokeWidth={2.1}
            className="size-[18px] text-chelth-teal-dark"
          />
          View Professional
        </Link>
      </div>
    </div>
  );
}
