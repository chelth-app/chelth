import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { KeyValueList } from "@/components/ui/key-value-list";
import { Panel } from "@/components/ui/panel";
import { getFinancialSettings } from "@/features/financial";
import { loadOrganisationPage, StepUpNotice } from "@/features/organisations";
import { listPricingPolicies, TimeCalculationForm } from "@/features/pricing";
import { CAPABILITIES } from "@/lib/authz";
import {
  amountForMinutes,
  describeRounding,
  formatHoursMinutes,
  formatMoney,
  pricedMinutes,
  roundingInEffect,
} from "@/lib/domain/pricing";
import { todayIsoDate } from "@/lib/domain/shifts";

import { canOpenSection, settingsHref } from "../_components/settings-sections";
import { SettingsActionLink, SettingsActionRow } from "../_components/settings-ui";

export const metadata: Metadata = { title: "Rates & Billing" };

/**
 * Settings → Rates & Billing. Time calculation method (P0-E9-3F): the existing
 * versioned rounding policy (exact minutes = mode "none", the default). Rate cards and rounding / overtime policies are
 * versioned records with effective dates, managed on Rates; this section
 * points there and shows the invoice reference prefix read-only. No currency,
 * invoice terms, billing contact, tax or payment settings exist in Chelth.
 */
export default async function SettingsRatesPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/settings/rates">) {
  const context = await loadOrganisationPage((await params).organisationId);
  const { organisationId, organisation, can } = context;
  if (!canOpenSection("rates", organisation.type, can)) notFound();
  const canReadFinancial =
    can(CAPABILITIES.PAYROLL_VIEW) === "granted" || can(CAPABILITIES.INVOICE_VIEW) === "granted";
  const financialEditable =
    can(CAPABILITIES.PAYROLL_APPROVE) === "granted" &&
    can(CAPABILITIES.INVOICE_APPROVE) === "granted";
  const manageRates = can(CAPABILITIES.RATES_MANAGE);
  const [settings, policies] = await Promise.all([
    canReadFinancial ? getFinancialSettings(organisationId) : Promise.resolve(null),
    listPricingPolicies(organisationId),
  ]);
  const today = todayIsoDate();
  const current = roundingInEffect(policies.rounding, today);
  const mode = current?.roundingMode ?? "none";
  const increment = current?.increment ?? null;
  const scheduled = policies.rounding
    .filter((policy) => policy.status === "active" && policy.effectiveFrom > today)
    .sort((a, b) => (a.effectiveFrom > b.effectiveFrom ? 1 : -1));
  // Worked example (display only; the database prices every timesheet).
  const exampleMinutes = 457;
  const exampleRate = 3000;
  const examplePriced = pricedMinutes(exampleMinutes, mode, increment);

  return (
    <>
      <Panel
        titleId="time-calculation-heading"
        title={<>Time Calculation Method</>}
        description={
          <>
            How worked time becomes a pay or bill amount. The same method is used for pricing,
            payroll and invoices.
          </>
        }
      >
        <KeyValueList
          className="max-w-3xl"
          items={[
            { label: "In effect today", value: describeRounding(mode, increment) },
            ...(scheduled.map((policy) => ({
              label: `From ${policy.effectiveFrom}`,
              value: describeRounding(policy.roundingMode ?? "none", policy.increment ?? null),
            })) ?? []),
            {
              label: "Example",
              value: (
                <span className="tabular-nums">
                  Worked {formatHoursMinutes(exampleMinutes)} · calculation basis {examplePriced}{" "}
                  minutes · {formatMoney(exampleRate, "USD")}/hour ={" "}
                  {formatMoney(amountForMinutes(exampleRate, examplePriced), "USD")}
                </span>
              ),
            },
          ]}
        />
        {manageRates === "granted" ? (
          <TimeCalculationForm
            organisationId={organisationId}
            today={today}
            current={{ mode, increment }}
          />
        ) : manageRates === "step_up_required" ? (
          <StepUpNotice returnTo={settingsHref(organisationId, "rates")}>
            Changing the time calculation method requires verification with your authenticator app.
          </StepUpNotice>
        ) : null}
      </Panel>

      <Panel
        titleId="rate-integrity-heading"
        title={<>Rate Integrity Rules</>}
        description={
          <>
            Rate cards and rounding and overtime policies are versioned with effective dates. A new
            version applies to work from its effective date; priced timesheets, payroll and invoice
            drafts keep the version that was applied.
          </>
        }
      >
        <SettingsActionRow>
          <SettingsActionLink href={`/app/organisations/${organisationId}/rates`} icon="rates">
            Manage rate cards and policies on Rates
          </SettingsActionLink>
        </SettingsActionRow>
      </Panel>

      {settings ? (
        <Panel
          titleId="invoice-numbering-heading"
          title={<>Invoice Numbering</>}
          description={<>The prefix used for new invoice draft references.</>}
        >
          <KeyValueList
            className="max-w-3xl"
            items={[
              { label: "Invoice draft prefix", value: settings.invoiceReferencePrefix },
              { label: "Payroll batch prefix", value: settings.payrollReferencePrefix },
            ]}
          />
          {financialEditable ? (
            <SettingsActionRow>
              <SettingsActionLink href={settingsHref(organisationId, "payroll")} icon="timesheets">
                Change in Timesheets &amp; Payroll
              </SettingsActionLink>
            </SettingsActionRow>
          ) : null}
        </Panel>
      ) : null}
    </>
  );
}
