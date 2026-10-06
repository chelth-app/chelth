import {
  financeAreas,
  getMyCapabilities,
  getOrganisation,
  organisationIdSchema,
} from "@/features/organisations";
import { capabilityState } from "@/lib/authz";

import { FinanceWorkspaceNav } from "./_components/finance-workspace-nav";

/**
 * Finance workspace (P0-E8-F2.5): Rates, Pricing, Payroll and Invoices keep
 * their own routes (this route group adds no URL segment) and share one
 * Finance navigation above every page, records included. The navigation lists
 * only the areas the caller can open — a UI hint; each page applies its own
 * gate and the database re-authorises every operation. Pages keep their own
 * header and styling (Invoices is not on the locked system yet).
 */
export default async function FinanceLayout({
  children,
  params,
}: LayoutProps<"/app/organisations/[organisationId]">) {
  const parsed = organisationIdSchema.safeParse((await params).organisationId);
  if (!parsed.success) return children;
  const organisationId = parsed.data;
  const organisation = await getOrganisation(organisationId);
  if (!organisation) return children;
  const grants = await getMyCapabilities(organisationId);
  const areas = financeAreas(organisation.type, (capability) =>
    capabilityState(grants, capability),
  );

  return (
    <>
      {areas.length > 0 ? (
        <FinanceWorkspaceNav organisationId={organisationId} areas={areas} />
      ) : null}
      {children}
    </>
  );
}
