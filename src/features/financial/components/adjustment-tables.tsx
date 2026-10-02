import type { Route } from "next";
import Link from "next/link";

import { DataTableRegion } from "@/components/ui/data-table";
import { InlineActionForm } from "@/components/forms/inline-action-form";
import { Badge } from "@/components/ui/badge";
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

const TH = "px-3 py-2 font-medium";

function StateCell({ state }: { state: string }) {
  return (
    <Badge tone={state === "required" ? "warning" : state === "in_progress" ? "info" : "danger"}>
      {adjustmentStateLabel(state)}
    </Badge>
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
    return <p className="text-sm text-muted-foreground">No locked payroll needs an adjustment.</p>;
  }
  const base = `/app/organisations/${organisationId}/payroll`;
  return (
    <DataTableRegion aria-label="Payroll adjustments required">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
          <tr>
            <th scope="col" className={TH}>
              Worker · week
            </th>
            <th scope="col" className={TH}>
              Original batch
            </th>
            <th scope="col" className={TH}>
              Revision
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Estimated change
            </th>
            <th scope="col" className={TH}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.timesheetId} className="border-b border-border align-top last:border-0">
              <td className="px-3 py-2">
                <div className="font-medium">{row.workerName}</div>
                <div className="text-xs text-muted-foreground">
                  {formatPeriod(row.periodStart, row.periodEnd)}
                </div>
              </td>
              <td className="px-3 py-2">
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
              </td>
              <td className="px-3 py-2">
                Revision {row.baseRevision} → {row.currentRevision}
                <div className="text-xs text-muted-foreground">
                  {row.currentPriced ? "Priced" : "Not priced yet"}
                </div>
              </td>
              <td className="px-3 py-2">
                <StateCell state={row.state} />
              </td>
              <td className="px-3 py-2 text-right">
                {row.netDeltaMinor !== null && row.currency ? (
                  <SignedAmount minor={row.netDeltaMinor} currency={row.currency} side="pay" />
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2">
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
    return <p className="text-sm text-muted-foreground">No payroll adjustments yet.</p>;
  }
  return (
    <DataTableRegion aria-label="Payroll adjustments table">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
          <tr>
            <th scope="col" className={TH}>
              Adjustment
            </th>
            <th scope="col" className={TH}>
              Worker · week
            </th>
            <th scope="col" className={TH}>
              Adjusts
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Net change
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border align-top last:border-0">
              <td className="px-3 py-2">
                <Link
                  href={
                    `/app/organisations/${organisationId}/payroll/adjustments/${row.id}` as Route
                  }
                  className="font-medium text-primary underline underline-offset-4"
                >
                  {row.reference}
                </Link>
              </td>
              <td className="px-3 py-2">
                {row.workerName}
                <div className="text-xs text-muted-foreground">
                  {formatPeriod(row.periodStart, row.periodEnd)}
                </div>
              </td>
              <td className="px-3 py-2">
                {row.originalBatchReference}
                <div className="text-xs text-muted-foreground">
                  Revision {row.fromRevision} → {row.toRevision}
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  <PayrollStatusBadge status={row.status} />
                  <AttentionBadge code={row.attention} />
                </div>
              </td>
              <td className="px-3 py-2 text-right">
                <SignedAmount minor={row.netDeltaMinor} currency={row.currency} side="pay" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
    return (
      <p className="text-sm text-muted-foreground">No locked invoice draft needs an adjustment.</p>
    );
  }
  const base = `/app/organisations/${organisationId}/invoices`;
  const facilities = [...new Set(rows.map((row) => row.facilityName))];
  return (
    <>
      {facilities.map((facility) => (
        <div key={facility} className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">{facility}</h3>
          <DataTableRegion aria-label={`Invoice adjustments required for ${facility}`}>
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className={TH}>
                    Worker · week
                  </th>
                  <th scope="col" className={TH}>
                    Original draft
                  </th>
                  <th scope="col" className={TH}>
                    Revision
                  </th>
                  <th scope="col" className={TH}>
                    Status
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Estimated change
                  </th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((row) => row.facilityName === facility)
                  .map((row) => (
                    <tr
                      key={`${row.timesheetId}-${row.relationshipId}`}
                      className="border-b border-border align-top last:border-0"
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{row.workerName}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatPeriod(row.periodStart, row.periodEnd)}
                        </div>
                      </td>
                      <td className="px-3 py-2">
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
                      </td>
                      <td className="px-3 py-2">
                        Revision {row.baseRevision} → {row.currentRevision}
                        <div className="text-xs text-muted-foreground">
                          {row.currentPriced ? "Priced" : "Not priced yet"}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <StateCell state={row.state} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {row.netDeltaMinor !== null && row.currency ? (
                          <SignedAmount
                            minor={row.netDeltaMinor}
                            currency={row.currency}
                            side="bill"
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
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
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
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
    return <p className="text-sm text-muted-foreground">No invoice adjustment drafts yet.</p>;
  }
  return (
    <DataTableRegion aria-label="Invoice adjustments table">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
          <tr>
            <th scope="col" className={TH}>
              Adjustment
            </th>
            <th scope="col" className={TH}>
              Facility · week
            </th>
            <th scope="col" className={TH}>
              Adjusts
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Net change
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border align-top last:border-0">
              <td className="px-3 py-2">
                <Link
                  href={
                    `/app/organisations/${organisationId}/invoices/adjustments/${row.id}` as Route
                  }
                  className="font-medium text-primary underline underline-offset-4"
                >
                  {row.reference}
                </Link>
              </td>
              <td className="px-3 py-2">
                {row.facilityName}
                <div className="text-xs text-muted-foreground">
                  {formatPeriod(row.periodStart, row.periodEnd)}
                </div>
              </td>
              <td className="px-3 py-2">
                {row.originalDraftReference}
                <div className="text-xs text-muted-foreground">
                  Revision {row.fromRevision} → {row.toRevision}
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  <InvoiceStatusBadge status={row.status} />
                  <AttentionBadge code={row.attention} />
                </div>
              </td>
              <td className="px-3 py-2 text-right">
                <SignedAmount
                  minor={row.netDeltaMinor}
                  currency={row.currency}
                  side="bill"
                  direction={row.direction}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableRegion>
  );
}
