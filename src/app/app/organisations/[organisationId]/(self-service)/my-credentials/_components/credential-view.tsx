import type { ReactNode } from "react";

import { REF_TEXT } from "@/components/reference/locked-reference";
import type { StatusTone } from "@/components/ui/status-chip";
import type { CredentialDocument } from "@/features/credentials";
import type {
  CredentialStatus,
  CredentialVersionStatus,
  VerificationOutcome,
} from "@/lib/domain/credentials";
import { cn } from "@/lib/utils/cn";

import { INK, WORKER_CARD } from "../../my-shifts/_components/worker-cards";

/*
 * Worker credential presentation (P0-E9-3C), in the W1 worker card language.
 * Labels only — every state comes from the existing read models and rules.
 */

/** One state per credential for this agency, from real version and review data. */
export function credentialState(input: {
  status: CredentialStatus;
  latestVersionStatus: CredentialVersionStatus | null;
  agencyOutcome: VerificationOutcome | null;
}): { label: string; tone: StatusTone } {
  if (input.status === "withdrawn") return { label: "Withdrawn", tone: "neutral" };
  if (input.latestVersionStatus === "draft") return { label: "Draft", tone: "neutral" };
  if (input.latestVersionStatus === "submitted") {
    if (input.agencyOutcome === "verified") return { label: "Verified", tone: "success" };
    if (input.agencyOutcome === "rejected") return { label: "Rejected", tone: "danger" };
    return { label: "Submitted", tone: "info" };
  }
  return { label: "Draft", tone: "neutral" };
}

export type EvidenceState = "none" | "interrupted" | "checking" | "retrying" | "ready" | "unusable";

/** The worker-language state of a version's evidence (its most recent document). */
export function evidenceState(documents: CredentialDocument[]): {
  state: EvidenceState;
  latest: CredentialDocument | null;
} {
  const latest = [...documents].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  if (!latest) return { state: "none", latest };
  switch (latest.status) {
    case "upload_pending":
      return { state: "interrupted", latest };
    case "scanning":
      return { state: latest.scanFailed ? "retrying" : "checking", latest };
    case "clean":
      return { state: "ready", latest };
    case "rejected":
    case "quarantined":
      return { state: "unusable", latest };
  }
}

export const EVIDENCE_COPY: Record<
  EvidenceState,
  { title: string; note: string; tone: "success" | "info" | "warning" }
> = {
  none: { title: "No document yet", note: "Add evidence to continue.", tone: "info" },
  interrupted: {
    title: "Upload didn't finish",
    note: "Upload the document again.",
    tone: "warning",
  },
  checking: {
    title: "Checking document…",
    note: "This usually takes a minute. You can submit for review while it is checked.",
    tone: "info",
  },
  retrying: {
    title: "Checking document…",
    note: "We couldn't finish checking this document yet. We'll keep trying.",
    tone: "warning",
  },
  ready: {
    title: "Document ready",
    note: "Your document passed its security check.",
    tone: "success",
  },
  unusable: {
    title: "This document cannot be used",
    note: "Upload a different file.",
    tone: "warning",
  },
};

/** A worker card section: the locked 20 / 600 panel heading, one optional line, then content. */
export function WorkerCardSection({
  id,
  title,
  note,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn(WORKER_CARD, className)}>
      <div className="flex flex-col gap-0.5">
        <h2 id={id} className={REF_TEXT.panelTitle}>
          {title}
        </h2>
        {note ? <p className="text-[13px] leading-[18px] text-slate-600">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Label / value rows for a compact summary (review step, record facts). */
export function SummaryRows({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="flex flex-col divide-y divide-[rgba(18,107,103,0.10)] rounded-[12px] border border-[rgba(18,107,103,0.10)] bg-[#fbfdfd]">
      {rows.map((row) => (
        <div key={row.label} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
          <dt className="shrink-0 text-[13px] leading-5 text-slate-600">{row.label}</dt>
          <dd
            className={cn("min-w-0 text-right text-[14px] leading-5 font-medium break-words", INK)}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Progress through Details → Evidence → Review (one route, progressive sections). */
export function CredentialSteps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Details", "Evidence", "Review"] as const;
  return (
    <ol aria-label="Add credential steps" className="grid grid-cols-3 gap-2">
      {steps.map((step, index) => {
        const number = index + 1;
        const state = number < current ? "done" : number === current ? "current" : "next";
        return (
          <li
            key={step}
            aria-current={state === "current" ? "step" : undefined}
            className="flex flex-col gap-1.5"
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-1 rounded-full",
                state === "next" ? "bg-[rgba(18,107,103,0.14)]" : "bg-chelth-teal",
              )}
            />
            <span
              className={cn(
                "text-[12.5px] leading-4",
                state === "current" ? "font-semibold text-chelth-teal-dark" : "text-slate-600",
              )}
            >
              <span className="sr-only">
                Step {number} of 3{state === "done" ? ", done" : ""}:{" "}
              </span>
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
