import type { Route } from "next";

import { SectionTabs } from "@/components/ui/section-tabs";
import { CAPABILITIES, type CapabilityKey, type CapabilityState } from "@/lib/authz";

type Mode = "payroll" | "invoices" | "rates" | "pricing";

const PAIRS: Record<Mode, { label: string; pair: readonly [Mode, Mode] }> = {
  payroll: { label: "Payroll and invoices", pair: ["payroll", "invoices"] },
  invoices: { label: "Payroll and invoices", pair: ["payroll", "invoices"] },
  rates: { label: "Rates and pricing", pair: ["rates", "pricing"] },
  pricing: { label: "Rates and pricing", pair: ["rates", "pricing"] },
};

const MODE: Record<Mode, { label: string; capability: CapabilityKey }> = {
  payroll: { label: "Payroll", capability: CAPABILITIES.PAYROLL_VIEW },
  invoices: { label: "Invoices", capability: CAPABILITIES.INVOICE_VIEW },
  rates: { label: "Rates", capability: CAPABILITIES.RATES_VIEW },
  pricing: { label: "Pricing", capability: CAPABILITIES.PRICING_VIEW },
};

/**
 * P3-F mode switch under the finance page title (reference: "Payroll |
 * Invoices"). Route links between EXISTING pages, shown only when the caller
 * can open both (same predicate as the page gates); otherwise nothing.
 */
export function FinanceModeTabs({
  organisationId,
  current,
  can,
}: {
  organisationId: string;
  current: Mode;
  can: (capability: CapabilityKey) => CapabilityState;
}) {
  const { label, pair } = PAIRS[current];
  if (pair.some((mode) => can(MODE[mode].capability) === "not_held")) return null;
  return (
    <SectionTabs
      label={label}
      tabs={pair.map((mode) => ({
        label: MODE[mode].label,
        href: `/app/organisations/${organisationId}/${mode}` as Route,
        current: mode === current,
      }))}
    />
  );
}
