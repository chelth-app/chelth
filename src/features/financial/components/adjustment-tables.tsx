import type { Route } from "next";
import Link from "next/link";

import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRegion,
  DataTableRow,
} from "@/components/ui/data-table";
import { InlineActionForm } from "@/components/forms/inline-action-form";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusChip } from "@/components/ui/status-chip";
import { adjustmentStateLabel } from "@/lib/domain/financial";
import { formatPeriod } from "@/lib/domain/timesheets";

import {
  createInvoiceAdjustmentAction,
  createPayrollAdjustmentAction,
} from "../adjustment-actions";
import type {
  InvoiceAdjustmentCandidate,
  InvoiceAdjustmentRow,
  PayrollAdjustmentCandidate,
  PayrollAdjustmentRow,
} from "../adjustment-queries";
import { AttentionBadge, InvoiceStatusBadge, PayrollStatusBadge } from "./financial-tables";
import { SignedAmount } from "./signed-amount";

function StateCell({ state }: { state: string }) {
  return (
    <StatusChip
      tone={state === "required" ? "attention" : state === "in_progress" ? "info" : "danger"}
    >
      {adjustmentStateLabel(state)}
    </StatusChip>
  );
}

/** Revisions of locked payroll work that still need (or are getting) an adjustment. */
export function PayrollAdjustmentCandidates({
  rows,
  organisationId,
  canPrepare,
}: {
  rows: PayrollAdjustmentCandidate[];
  organisationId: string;
  canPrepare: boolean;
}) {
  if (rows.length === 0) {
    return <EmptyState headingLevel={3} title="No locked payroll needs an adjustment." />;
  }
  const base = `/app/organisations/${organisationId}/payroll`;
  return (
    <DataTableRegion aria-label="Payroll adjustments required">
      <DataTable className="min-w-[900px]">
        <DataTableHead>
          <tr>
            <DataTableHeaderCell>Worker · week</DataTableHeaderCell>
            <DataTableHeaderCell>Original batch</DataTableHeaderCell>
            <DataTableHeaderCell>Revision</DataTableHeaderCell>
            <DataTableHeaderCell>Status</DataTableHeaderCell>
            <DataTableHeaderCell numeric>Estimated change</DataTableHeaderCell>
            <DataTableHeaderCell>
              <span className="sr-only">Actions</span>
            </DataTableHeaderCell>
          </tr>
        </DataTableHead>
        <tbody>
          {rows.map((row) => (
            <DataTableRow key={row.timesheetId}>
              <DataTableCell>
                <div className="font-medium">{row.workerName}</div>
                <div className="text-xs text-muted-foreground">
                  {formatPeriod(row.periodStart, row.periodEnd)}
                </div>
              </DataTableCell>
              <DataTableCell>
                {row.originalBatchId ? (
                  <Link
                    href={`${base}/${row.originalBatchId}` as Route}
                    className="text-primary underline underline-offset-4"
                  >
                    {row.originalBatchReference}
                  </Link>
                ) : (
                  "—"
                )}
                {row.baseReference && row.baseReference !== row.originalBatchReference ? (
                  <div className="text-xs text-muted-foreground">
                    Last accounted in {row.baseReference}
                  </div>
                ) : null}
              </DataTableCell>
              <DataTableCell>
                Revision {row.baseRevision} → {row.currentRevision}
                <div className="text-xs text-muted-foreground">
                  {row.currentPriced ? "Priced" : "Not priced yet"}
                </div>
              </DataTableCell>
              <DataTableCell>
                <StateCell state={row.state} />
              </DataTableCell>
              <DataTableCell className="text-right">
                {row.netDeltaMinor !== null && row.currency ? (
                  <SignedAmount minor={row.netDeltaMinor} currency={row.currency} side="pay" />
                ) : (
                  "—"
                )}
              </DataTableCell>
              <DataTableCell>
                {row.state === "required" && canPrepare ? (
                  <InlineActionForm
                    action={createPayrollAdjustmentAction}
                    fields={{ organisationId, timesheetId: row.timesheetId }}
                    label="Prepare adjustment"
                    accessibleLabel={`Prepare payroll adjustment for ${row.workerName}, revision ${row.baseRevision} to ${row.currentRevision}`}
                    variant="primary"
                  />
                ) : row.openAdjustmentId ? (
                  <Link
                    href={`${base}/adjustments/${row.openAdjustmentId}` as Route}
                    className="text-primary underline underline-offset-4"
                  >
                    {row.openAdjustmentReference}
                  </Link>
                ) : null}
              </DataTableCell>
            </DataTableRow>
          ))}
        </tbody>
      </DataTable>
    </DataTableRegion>
  );
}

export function PayrollAdjustmentsTable({
  rows,
  organisationId,
}: {
  rows: PayrollAdjustmentRow[];
  organisationId: string;
}) {
  if (rows.length === 0) {
    return <EmptyState headingLevel={3} title="No payroll adjustments yet." />;
  }
  return (
    <DataTableRegion aria-label="Payroll adjustments table">
      <DataTable className="min-w-[860px]">
        <DataTableHead>
          <tr>
            <DataTableHeaderCell>Adjustment</DataTableHeaderCell>
            <DataTableHeaderCell>Worker · week</DataTableHeaderCell>
            <DataTableHeaderCell>Adjusts</DataTableHeaderCell>
            <DataTableHeaderCell>Status</DataTableHeaderCell>
            <DataTableHeaderCell numeric>Net change</DataTableHeaderCell>
          </tr>
        </DataTableHead>
        <tbody>
          {rows.map((row) => (
            <DataTableRow key={row.id}>
              <DataTableCell>
                <Link
                  href={
                    `/app/organisations/${organisationId}/payroll/adjustments/${row.id}` as Route
                  }
                  className="font-medium text-primary underline underline-offset-4"
                >
                  {row.reference}
                </Link>
              </DataTableCell>
              <DataTableCell>
                {row.workerName}
                <div className="text-xs text-muted-foreground">
                  {formatPeriod(row.periodStart, row.periodEnd)}
                </div>
              </DataTableCell>
              <DataTableCell>
                {row.originalBatchReference}
                <div className="text-xs text-muted-foreground">
                  Revision {row.fromRevision} → {row.toRevision}
                </div>
              </DataTableCell>
              <DataTableCell>
                <div className="flex flex-wrap gap-1">
                  <PayrollStatusBadge status={row.status} />
                  <AttentionBadge code={row.attention} />
                </div>
              </DataTableCell>
              <DataTableCell className="text-right">
                <SignedAmount minor={row.netDeltaMinor} currency={row.currency} side="pay" />
              </DataTableCell>
            </DataTableRow>
          ))}
        </tbody>
      </DataTable>
    </DataTableRegion>
  );
}

/** Bill-side revisions needing an adjustment, grouped by facility. */
export function InvoiceAdjustmentCandidates({
  rows,
  organisationId,
  canPrepare,
}: {
  rows: InvoiceAdjustmentCandidate[];
  organisationId: string;
  canPrepare: boolean;
}) {
  if (rows.length === 0) {
    return <EmptyState headingLevel={3} title="No locked invoice draft needs an adjustment." />;
  }
  const base = `/app/organisations/${organisationId}/invoices`;
  const facilities = [...new Set(rows.map((row) => row.facilityName))];
  return (
    <>
      {facilities.map((facility) => (
        <div key={facility} className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">{facility}</h3>
          <DataTableRegion aria-label={`Invoice adjustments required for ${facility}`}>
            <DataTable className="min-w-[860px]">
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Worker · week</DataTableHeaderCell>
                  <DataTableHeaderCell>Original draft</DataTableHeaderCell>
                  <DataTableHeaderCell>Revision</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell numeric>Estimated change</DataTableHeaderCell>
                  <DataTableHeaderCell>
                    <span className="sr-only">Actions</span>
                  </DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                {rows
                  .filter((row) => row.facilityName === facility)
                  .map((row) => (
                    <DataTableRow key={`${row.timesheetId}-${row.relationshipId}`}>
                      <DataTableCell>
                        <div className="font-medium">{row.workerName}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatPeriod(row.periodStart, row.periodEnd)}
                        </div>
                      </DataTableCell>
                      <DataTableCell>
                        {row.originalDraftId ? (
                          <Link
                            href={`${base}/${row.originalDraftId}` as Route}
                            className="text-primary underline underline-offset-4"
                          >
                            {row.originalDraftReference}
                          </Link>
                        ) : (
                          "—"
                        )}
                        {row.baseReference && row.baseReference !== row.originalDraftReference ? (
                          <div className="text-xs text-muted-foreground">
                            Last accounted in {row.baseReference}
                          </div>
                        ) : null}
                      </DataTableCell>
                      <DataTableCell>
                        Revision {row.baseRevision} → {row.currentRevision}
                        <div className="text-xs text-muted-foreground">
                          {row.currentPriced ? "Priced" : "Not priced yet"}
                        </div>
                      </DataTableCell>
                      <DataTableCell>
                        <StateCell state={row.state} />
                      </DataTableCell>
                      <DataTableCell className="text-right">
                        {row.netDeltaMinor !== null && row.currency ? (
                          <SignedAmount
                            minor={row.netDeltaMinor}
                            currency={row.currency}
                            side="bill"
                          />
                        ) : (
                          "—"
                        )}
                      </DataTableCell>
                      <DataTableCell>
                        {row.state === "required" && canPrepare ? (
                          <InlineActionForm
                            action={createInvoiceAdjustmentAction}
                            fields={{
                              organisationId,
                              timesheetId: row.timesheetId,
                              relationshipId: row.relationshipId,
                            }}
                            label="Prepare adjustment"
                            accessibleLabel={`Prepare invoice adjustment for ${facility}, ${row.workerName}, revision ${row.baseRevision} to ${row.currentRevision}`}
                            variant="primary"
                          />
                        ) : row.openAdjustmentId ? (
                          <Link
                            href={`${base}/adjustments/${row.openAdjustmentId}` as Route}
                            className="text-primary underline underline-offset-4"
                          >
                            {row.openAdjustmentReference}
                          </Link>
                        ) : null}
                      </DataTableCell>
                    </DataTableRow>
                  ))}
              </tbody>
            </DataTable>
          </DataTableRegion>
        </div>
      ))}
    </>
  );
}

export function InvoiceAdjustmentsTable({
  rows,
  organisationId,
}: {
  rows: InvoiceAdjustmentRow[];
  organisationId: string;
}) {
  if (rows.length === 0) {
    return <EmptyState headingLevel={3} title="No invoice adjustment drafts yet." />;
  }
  return (
    <DataTableRegion aria-label="Invoice adjustments table">
      <DataTable className="min-w-[860px]">
        <DataTableHead>
          <tr>
            <DataTableHeaderCell>Adjustment</DataTableHeaderCell>
            <DataTableHeaderCell>Facility · week</DataTableHeaderCell>
            <DataTableHeaderCell>Adjusts</DataTableHeaderCell>
            <DataTableHeaderCell>Status</DataTableHeaderCell>
            <DataTableHeaderCell numeric>Net change</DataTableHeaderCell>
          </tr>
        </DataTableHead>
        <tbody>
          {rows.map((row) => (
            <DataTableRow key={row.id}>
              <DataTableCell>
                <Link
                  href={
                    `/app/organisations/${organisationId}/invoices/adjustments/${row.id}` as Route
                  }
                  className="font-medium text-primary underline underline-offset-4"
                >
                  {row.reference}
                </Link>
              </DataTableCell>
              <DataTableCell>
                {row.facilityName}
                <div className="text-xs text-muted-foreground">
                  {formatPeriod(row.periodStart, row.periodEnd)}
                </div>
              </DataTableCell>
              <DataTableCell>
                {row.originalDraftReference}
                <div className="text-xs text-muted-foreground">
                  Revision {row.fromRevision} → {row.toRevision}
                </div>
              </DataTableCell>
              <DataTableCell>
                <div className="flex flex-wrap gap-1">
                  <InvoiceStatusBadge status={row.status} />
                  <AttentionBadge code={row.attention} />
                </div>
              </DataTableCell>
              <DataTableCell className="text-right">
                <SignedAmount
                  minor={row.netDeltaMinor}
                  currency={row.currency}
                  side="bill"
                  direction={row.direction}
                />
              </DataTableCell>
            </DataTableRow>
          ))}
        </tbody>
      </DataTable>
    </DataTableRegion>
  );
}
