import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Panel } from "@/components/ui/panel";
import {
  FinancialSettingsForm,
  getFinancialSettings,
  MakerCheckerForm,
} from "@/features/financial";
import { loadOrganisationPage, StepUpNotice } from "@/features/organisations";
import { getTimesheetWeekStart, WeekStartForm } from "@/features/timesheets";
import { CAPABILITIES } from "@/lib/authz";

import { canOpenSection, settingsHref } from "../_components/settings-sections";

export const metadata: Metadata = { title: "Timesheets & Payroll" };

/**
 * Settings → Timesheets & Payroll. The existing timesheet-week, payroll
 * period / reference and maker-checker forms (moved from the Attendance and
 * Payroll pages, P0-E8-S9H) under the same gates: attendance.manage_settings
 * for the timesheet week; payroll.approve + invoice.approve for financial
 * settings. Changes apply to future periods; prepared batches and approved
 * timesheets are never rewritten.
 */
export default async function SettingsPayrollPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/settings/payroll">) {
  const context = await loadOrganisationPage((await params).organisationId);
  const { organisationId, organisation, can } = context;
  if (!canOpenSection("payroll", organisation.type, can)) notFound();

  const weekState = can(CAPABILITIES.ATTENDANCE_MANAGE_SETTINGS);
  const approve = can(CAPABILITIES.PAYROLL_APPROVE);
  const invoiceApprove = can(CAPABILITIES.INVOICE_APPROVE);
  const financialEditable = approve === "granted" && invoiceApprove === "granted";
  const financialStepUp =
    !financialEditable &&
    approve !== "not_held" &&
    invoiceApprove !== "not_held" &&
    (approve === "step_up_required" || invoiceApprove === "step_up_required");

  const [weekStartsOn, settings] = await Promise.all([
    weekState === "granted" ? getTimesheetWeekStart(organisationId) : Promise.resolve(null),
    financialEditable ? getFinancialSettings(organisationId) : Promise.resolve(null),
  ]);

  return (
    <>
      {weekState === "step_up_required" || financialStepUp ? (
        <StepUpNotice returnTo={settingsHref(organisationId, "payroll")}>
          Changing timesheet and payroll settings requires verification with your authenticator app.
        </StepUpNotice>
      ) : null}

      {weekStartsOn !== null ? (
        <Panel
          titleId="timesheet-week-heading"
          title={<>Timesheet Week</>}
          description={
            <>Timesheets are weekly. The week start is fixed once the first timesheet exists.</>
          }
        >
          <WeekStartForm organisationId={organisationId} weekStartsOn={weekStartsOn} />
        </Panel>
      ) : null}

      {settings ? (
        <>
          <Panel
            titleId="payroll-settings-heading"
            title={<>Pay Period and References</>}
            description={
              <>
                Payroll periods are calendar dates. Changing them applies to periods not yet used; a
                new period may not overlap one that already has a batch.
              </>
            }
          >
            <FinancialSettingsForm
              organisationId={organisationId}
              periodType={settings.payrollPeriodType}
              anchorDate={settings.payrollAnchorDate}
              payrollPrefix={settings.payrollReferencePrefix}
              invoicePrefix={settings.invoiceReferencePrefix}
            />
          </Panel>

          <Panel
            titleId="finance-controls-heading"
            title={<>Finance Controls</>}
            description={
              <>
                Applies to payroll batches, invoice drafts and adjustments. Chelth prepares and
                exports financial documents; it never executes payments.
              </>
            }
          >
            <MakerCheckerForm
              organisationId={organisationId}
              required={settings.makerCheckerRequired}
            />
          </Panel>
        </>
      ) : null}
    </>
  );
}
