import { WorkerFrame } from "../_components/worker-frame";

/**
 * Worker self-service pages (My Shifts, My Credentials) use the P7 worker
 * frame (P0-E8-S6) — never the operational workspace shell.
 */
export default async function SelfServiceLayout({
  children,
  params,
}: LayoutProps<"/app/organisations/[organisationId]">) {
  return <WorkerFrame rawOrganisationId={(await params).organisationId}>{children}</WorkerFrame>;
}
