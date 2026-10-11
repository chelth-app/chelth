import { getRequestTerminology, TerminologyProvider } from "@/features/localization";

import { WorkerFrame } from "../_components/worker-frame";

/**
 * Worker self-service pages (My Shifts, My Credentials) use the P7 worker
 * frame (P0-E8-S6) — never the operational workspace shell. P0-E9-3I: the
 * workspace's spelling is provided to client components here too.
 */
export default async function SelfServiceLayout({
  children,
  params,
}: LayoutProps<"/app/organisations/[organisationId]">) {
  const [{ organisationId }, terms] = await Promise.all([params, getRequestTerminology()]);
  return (
    <TerminologyProvider terms={terms}>
      <WorkerFrame rawOrganisationId={organisationId}>{children}</WorkerFrame>
    </TerminologyProvider>
  );
}
