import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { KeyValueList } from "@/components/ui/key-value-list";
import { Panel } from "@/components/ui/panel";
import { getFinancialSettings } from "@/features/financial";
import { loadOrganisationPage } from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";

import { canOpenSection, settingsHref } from "../_components/settings-sections";
import { SettingsActionLink, SettingsActionRow } from "../_components/settings-ui";

export const metadata: Metadata = { title: "Rates & Billing" };

/**
 * Settings → Rates & Billing. Rate cards and rounding / overtime policies are
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
  const settings = canReadFinancial ? await getFinancialSettings(organisationId) : null;

  return (
    <>
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
