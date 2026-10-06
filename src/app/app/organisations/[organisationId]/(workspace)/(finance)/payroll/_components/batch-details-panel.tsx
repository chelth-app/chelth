import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { DetailsTabs } from "@/components/reference/details-tabs";
import { RefChip } from "@/components/reference/locked-reference";
import { KeyValueList } from "@/components/ui/key-value-list";
import {
  HistoryList,
  type DocumentHistoryRow,
  type PayrollBatchRow,
  type PayrollWorkerTotalRow,
} from "@/features/financial";
import { attentionLabel, PAYROLL_BATCH_STATUS_LABELS } from "@/lib/domain/financial";
import { formatMoney } from "@/lib/domain/pricing";
import { formatPeriod, formatWorkedMinutes } from "@/lib/domain/timesheets";
import { cn } from "@/lib/utils/cn";

import { INK } from "../../_components/finance-locked";
import { attentionTone, PAYROLL_TONE } from "./payroll-tones";

/*
 * Payroll Batch Details — the canonical Chelth drawer (CHELTH-LOCKED-VISUAL-
 * SYSTEM.md, C) with batch content. Inspection only: every lifecycle step
 * (review, approve, lock, export, cancel) stays on the batch record with the
 * existing forms, step-up and maker-checker checks. Preparation and export
 * only — Chelth does not pay workers.
 */

const created = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

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

/** Quiet note row (neutral tile), as the drawer empty states. */
function QuietNote({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-muted text-muted-foreground [&>svg]:size-[19px]"
      >
        <WorkspaceNavIcon name="payroll" strokeWidth={2} />
      </span>
      <span className="flex flex-col">
        <span className="text-[14px] leading-5 font-medium text-slate-600">{title}</span>
        <span className="text-[12.5px] leading-[18px] text-muted-foreground">{note}</span>
      </span>
    </div>
  );
}

export type BatchDetails = {
  workers: PayrollWorkerTotalRow[];
  history: DocumentHistoryRow[];
};

export function BatchDetailsPanel({
  batch,
  details,
  recordHref,
  nextStep,
  makerChecker,
}: {
  batch: PayrollBatchRow;
  /** Worker totals and history, loaded for the first listed batches (null: open the record). */
  details: BatchDetails | null;
  recordHref: Route;
  /** The next lifecycle step this viewer can take on the record, if any. */
  nextStep: { label: string; href: Route } | null;
  makerChecker: boolean;
}) {
  const id = `batch-${batch.id}`;
  const period = formatPeriod(batch.periodStart, batch.periodEnd);
  const attention = attentionLabel(batch.attention);
  const history = [...(details?.history ?? [])].reverse();

  const overview = (
    <div className="flex flex-col">
      <Section id={`${id}-summary`} title="Batch Summary" divided={false}>
        <KeyValueList
          className="sm:grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] sm:gap-x-5"
          items={[
            {
              label: "Pay total",
              value: (
                <span className="font-semibold tabular-nums">
                  {formatMoney(batch.totalPayMinor, batch.currency)}
                </span>
              ),
            },
            { label: "Currency", value: batch.currency },
            { label: "Workers", value: <span className="tabular-nums">{batch.workerCount}</span> },
            { label: "Lines", value: <span className="tabular-nums">{batch.lineCount}</span> },
            {
              label: "Status",
              value: (
                <RefChip tone={PAYROLL_TONE[batch.status]} className="font-semibold">
                  {PAYROLL_BATCH_STATUS_LABELS[batch.status]}
                </RefChip>
              ),
            },
            { label: "Prepared by", value: batch.createdByName ?? "a former member" },
            { label: "Prepared", value: created.format(new Date(batch.createdAt)) },
            {
              label: "Exports",
              value: (
                <span className="tabular-nums">
                  {batch.exportCount === 0
                    ? "None yet"
                    : batch.exportCount === 1
                      ? "1 CSV export"
                      : `${batch.exportCount} CSV exports`}
                </span>
              ),
            },
          ]}
        />
      </Section>
      <Section id={`${id}-control`} title="Approval Control">
        <KeyValueList
          className="sm:grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] sm:gap-x-5"
          items={[
            { label: "Maker-checker", value: makerChecker ? "Required" : "Not required" },
            ...(makerChecker
              ? [
                  {
                    label: "Approval",
                    value: "By an eligible member other than the preparer",
                  },
                ]
              : []),
          ]}
        />
        {attention && batch.attention ? (
          <RefChip tone={attentionTone(batch.attention)} className="w-fit font-semibold">
            {attention}
          </RefChip>
        ) : null}
        <p className="text-[12.5px] leading-[18px] text-slate-600">
          Payroll preparation and export only. Chelth does not pay workers or calculate tax or
          deductions.
        </p>
      </Section>
    </div>
  );

  const workers = (
    <Section id={`${id}-workers`} title="Worker Totals" divided={false}>
      {!details ? (
        <QuietNote
          title="Worker totals are on the batch record"
          note="Open the record for each worker's lines."
        />
      ) : details.workers.length === 0 ? (
        <QuietNote title="No workers" note="This batch has no lines." />
      ) : (
        <ul
          aria-label={`${batch.reference} worker totals`}
          className="flex flex-col divide-y divide-[rgba(18,107,103,0.10)]"
        >
          {details.workers.map((worker) => (
            <li key={worker.agencyWorkerId} className="flex items-start gap-3 py-2.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13.5px] leading-5 font-medium text-chelth-navy">
                  {worker.workerName}
                </span>
                <span className="text-[12.5px] leading-[18px] text-slate-600">
                  {worker.lineCount === 1 ? "1 line" : `${worker.lineCount} lines`} ·{" "}
                  {formatWorkedMinutes(worker.regularMinutes + worker.overtimeMinutes)}
                  {worker.overtimeMinutes > 0
                    ? ` (${formatWorkedMinutes(worker.overtimeMinutes)} overtime)`
                    : ""}
                </span>
              </span>
              <span className="text-[13.5px] font-medium text-chelth-navy tabular-nums">
                {formatMoney(worker.totalPayMinor, batch.currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );

  const historyTab = (
    <Section id={`${id}-history`} title="History" divided={false}>
      {!details ? (
        <QuietNote
          title="History is on the batch record"
          note="Every lifecycle step is kept there."
        />
      ) : history.length === 0 ? (
        <QuietNote title="Nothing has happened yet" note="Steps appear here as they happen." />
      ) : (
        <HistoryList rows={history} label={`${batch.reference} history`} />
      )}
    </Section>
  );

  return (
    <div className="flex min-h-full flex-col text-[13.5px] leading-5">
      {/* Identity: payroll tile, reference, period, lifecycle state. */}
      <div className="flex items-start gap-4 pt-1">
        <span
          aria-hidden="true"
          className="inline-flex size-[84px] shrink-0 items-center justify-center rounded-[14px] bg-[radial-gradient(circle_at_30%_25%,#f4fdfa_0%,#d3f2e8_45%,#a9e3d3_100%)] text-chelth-teal-dark shadow-[0_6px_16px_rgba(0,90,96,0.18),inset_0_1px_0_rgba(255,255,255,0.9)] ring-4 ring-white [&>svg]:size-10"
        >
          <WorkspaceNavIcon name="payroll" strokeWidth={1.9} duotone />
        </span>
        <div className="flex min-w-0 flex-1 flex-col pt-1">
          <p
            className={cn(
              "font-display text-[21px] leading-[27px] font-bold tracking-[-0.02em]",
              INK,
            )}
          >
            {batch.reference}
          </p>
          <p className="truncate text-[14.5px] leading-[22px] font-medium text-slate-600">
            Payroll batch · {batch.currency}
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[13.5px] text-slate-600">
              <WorkspaceNavIcon
                name="shifts"
                strokeWidth={2.1}
                className="size-4 shrink-0 text-chelth-teal-dark"
              />
              <span className="truncate">{period}</span>
            </span>
            <RefChip
              tone={PAYROLL_TONE[batch.status]}
              className="h-7 px-3 text-[12.5px] font-semibold"
            >
              {PAYROLL_BATCH_STATUS_LABELS[batch.status]}
            </RefChip>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <DetailsTabs
          label={`${batch.reference} payroll batch`}
          tabs={[
            { id: "overview", label: "Overview", content: overview },
            { id: "workers", label: "Workers", content: workers },
            { id: "history", label: "History", content: historyTab },
          ]}
        />
      </div>

      {/* Locked action region: steps happen on the record, with the existing forms. */}
      <div className="mt-auto flex flex-col gap-2.5 pt-4">
        <Link
          href={nextStep?.href ?? recordHref}
          className="inline-flex h-12 items-center justify-center gap-2.5 rounded-[8px] bg-[linear-gradient(180deg,#00666c,#004f55)] text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_14px_-4px_rgba(0,58,64,0.45)] transition-[filter] hover:brightness-110"
        >
          <WorkspaceNavIcon name="payroll" strokeWidth={2.1} className="size-5" />
          {nextStep?.label ?? "Open Payroll Batch"}
        </Link>
        {nextStep ? (
          <Link
            href={recordHref}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-[rgba(0,90,96,0.35)] bg-white text-[14px] font-semibold text-chelth-navy shadow-[0_1px_2px_rgba(13,47,66,0.05)] hover:border-chelth-teal-dark hover:bg-[#f4fbf9]"
          >
            <WorkspaceNavIcon
              name="timesheets"
              strokeWidth={2.1}
              className="size-[18px] text-chelth-teal-dark"
            />
            Open Payroll Batch
          </Link>
        ) : null}
      </div>
    </div>
  );
}
