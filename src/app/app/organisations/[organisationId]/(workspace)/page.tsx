import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { RefChip } from "@/components/reference/locked-reference";
import {
  RECORD_ROW,
  RECORD_ROW_META,
  RECORD_ROW_TITLE,
  RecordList,
} from "@/components/reference/record-page";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import {
  getMyCapabilities,
  getOrganisation,
  listMyMemberships,
  listRoles,
  organisationIdSchema,
} from "@/features/organisations";
import { RelationshipStatusBadge, listPartnerRelationships } from "@/features/facilities";
import { listSharedWorkerCompliance } from "@/features/compliance";
import {
  facilityOnlyOrganisations,
  isWorkspaceStaff,
  OrganisationSections,
  StepUpNotice,
} from "@/features/organisations";
import { getMyWorkerRecord, WorkerStatusBadge } from "@/features/workforce";
import { requireAuthIdentity } from "@/lib/auth/session";
import { CAPABILITIES, capabilityState, type CapabilityGrant } from "@/lib/authz";
import { cn } from "@/lib/utils/cn";

import { HeaderAddAction } from "./(finance)/_components/finance-locked";
import { AgencyOperationsOverview } from "./_components/agency-operations-overview";
import { FacilityOperationsOverview } from "./_components/facility-operations-overview";
import { FacilityStepUpNotice } from "./_components/facility-step-up-notice";
import { getRequestTerminology, spell } from "@/features/localization";

export const metadata: Metadata = { title: "Overview" };

export default async function OrganisationPage({
  params,
}: PageProps<"/app/organisations/[organisationId]">) {
  const { organisationId: rawId } = await params;
  const parsedId = organisationIdSchema.safeParse(rawId);
  if (!parsedId.success) notFound();
  const organisationId = parsedId.data;

  const [, organisation] = await Promise.all([
    requireAuthIdentity(),
    getOrganisation(organisationId),
    getRequestTerminology(), // P0-E9-3I: spell() below uses the workspace's spelling
  ]);
  // RLS returns nothing for non-members: indistinguishable from "does not exist".
  if (!organisation) notFound();

  const grants: CapabilityGrant[] = await getMyCapabilities(organisationId);
  const can = (capability: Parameters<typeof capabilityState>[1]) =>
    capabilityState(grants, capability);
  const needsStepUp = grants.some((grant) => !grant.isSatisfied);
  const workspaceStaff = isWorkspaceStaff(grants.map((grant) => grant.capabilityKey));
  const agencyOverview = organisation.type === "agency" && workspaceStaff;
  // Facility workspace (P0-E8-QA-F1): the locked Overview family; other audiences unchanged.
  const facilityOverview = organisation.type === "facility" && workspaceStaff;
  // Administration (members, invitations, audit) lives in Settings (P0-E8-S9H).

  // P0-E9-3C: for a member who is only a healthcare worker here, the agency root
  // is not a home page — their work starts at My Shifts. Staff are unaffected.
  if (organisation.type === "agency" && !workspaceStaff) {
    if (await getMyWorkerRecord(organisationId)) {
      redirect(`/app/organisations/${organisationId}/my-shifts` as Route);
    }
  }

  // The caller's own roles (header), from their membership — no member administration needed.
  const [roles, memberships] = await Promise.all([
    listRoles(organisation.type),
    listMyMemberships(),
  ]);
  const roleName = new Map(roles.map((role) => [role.key, role.name]));
  const me = memberships.find((membership) => membership.organisation?.id === organisationId);
  const singleFacility = facilityOnlyOrganisations(memberships)?.length === 1;
  const [myWorkerRecord, partnerRelationships] = await Promise.all([
    organisation.type === "agency" ? getMyWorkerRecord(organisationId) : Promise.resolve(null),
    organisation.type === "facility" && can(CAPABILITIES.RELATIONSHIP_VIEW) === "granted"
      ? listPartnerRelationships(organisationId)
      : Promise.resolve([]),
  ]);
  // Facility side: the narrow, audited compliance projection per active relationship.
  const sharedCompliance =
    organisation.type === "facility" && can(CAPABILITIES.CREDENTIAL_VIEW) === "granted"
      ? await Promise.all(
          partnerRelationships
            .filter((relationship) => relationship.status === "active")
            .map(async (relationship) => ({
              relationship,
              workers: await listSharedWorkerCompliance(relationship.relationshipId),
            })),
        )
      : [];

  return (
    <div className={facilityOverview ? "chelth-locked flex flex-col gap-[13px]" : "contents"}>
      {agencyOverview ? (
        // Locked P2 header: title + one line of copy; workspace and role are in the top bar.
        <PageHeader
          variant="reference"
          className="ref-overview xl:-mb-1.5"
          title="Operations Overview"
          description={<p>Here&apos;s what&apos;s happening across your facilities today.</p>}
          meta={
            organisation.status !== "active" ? (
              <StatusChip tone="warning">{spell("Organization suspended")}</StatusChip>
            ) : undefined
          }
        />
      ) : facilityOverview ? (
        <PageHeader
          variant="reference"
          className="xl:mb-1"
          title={organisation.name}
          description={
            <p>Your staffing requests, who is expected and the timesheets waiting for sign-off.</p>
          }
          // A single-facility account has no chooser to go back to (P0-E9-3K entry).
          back={
            singleFacility ? undefined : (
              <Link href="/app" className="text-primary underline underline-offset-4">
                {spell("All organizations")}
              </Link>
            )
          }
          primaryAction={
            can(CAPABILITIES.SHIFT_REQUEST) === "granted" ? (
              <HeaderAddAction
                href={`/app/organisations/${organisationId}/staffing-requests#request-staff`}
              >
                Request staff
              </HeaderAddAction>
            ) : undefined
          }
          meta={
            <>
              <RefChip tone="info">Facility</RefChip>
              {organisation.status !== "active" ? (
                <RefChip tone="warning">{spell("Organization suspended")}</RefChip>
              ) : null}
              {me?.roleKeys.map((key) => (
                <RefChip key={key} tone="neutral">
                  {roleName.get(key) ?? key}
                </RefChip>
              ))}
            </>
          }
        />
      ) : (
        <PageHeader
          title={organisation.name}
          description={
            workspaceStaff ? (
              <p>
                {organisation.type === "agency"
                  ? "What needs attention, what is happening today and what is coming up."
                  : "Your staffing requests, who is expected and the timesheets waiting for sign-off."}
              </p>
            ) : undefined
          }
          back={
            <Link href="/app" className="text-primary underline underline-offset-4">
              {spell("All organizations")}
            </Link>
          }
          meta={
            <>
              <Badge tone="brand">{organisation.type === "agency" ? "Agency" : "Facility"}</Badge>
              {organisation.status !== "active" ? (
                <StatusChip tone="warning">{spell("Organization suspended")}</StatusChip>
              ) : null}
              {me?.roleKeys.map((key) => (
                <Badge key={key} tone="info">
                  {roleName.get(key) ?? key}
                </Badge>
              ))}
            </>
          }
        />
      )}

      {needsStepUp ? (
        facilityOverview ? (
          <FacilityStepUpNotice returnTo={`/app/organisations/${organisationId}`} />
        ) : (
          <StepUpNotice returnTo={`/app/organisations/${organisationId}`} />
        )
      ) : null}

      {agencyOverview ? (
        <AgencyOperationsOverview organisationId={organisationId} can={can} />
      ) : null}
      {facilityOverview ? (
        <FacilityOperationsOverview
          organisationId={organisationId}
          can={can}
          complianceAttention={
            organisation.type === "facility" && can(CAPABILITIES.CREDENTIAL_VIEW) === "granted"
              ? sharedCompliance
                  .flatMap(({ workers }) => workers)
                  .filter((worker) => worker.readiness !== "ready").length
              : null
          }
        />
      ) : null}

      {/*
        Workspace staff navigate with the sidebar (P0-E8-S1), so the section
        link grid is not repeated here. Self-service links (My shifts, My
        credentials) are not in the sidebar and stay. Self-service-only members
        are on the personal frame and keep every link they can use.
      */}
      <OrganisationSections
        organisationId={organisationId}
        selfServiceOnly={workspaceStaff}
        showWorkforce={can(CAPABILITIES.WORKER_VIEW) !== "not_held"}
        showFacilities={can(CAPABILITIES.FACILITY_VIEW) !== "not_held"}
        showCompliance={can(CAPABILITIES.CREDENTIAL_REQUIREMENTS_VIEW) !== "not_held"}
        showMyCredentials={myWorkerRecord !== null && myWorkerRecord.status !== "terminated"}
        showShifts={organisation.type === "agency" && can(CAPABILITIES.SHIFT_VIEW) !== "not_held"}
        showMyShifts={myWorkerRecord !== null}
        showAttendance={
          organisation.type === "agency" && can(CAPABILITIES.ATTENDANCE_VIEW) !== "not_held"
        }
        showTimesheets={
          (organisation.type === "agency" &&
            (can(CAPABILITIES.TIMESHEET_VIEW) !== "not_held" || myWorkerRecord !== null)) ||
          (organisation.type === "facility" &&
            can(CAPABILITIES.TIMESHEET_FACILITY_SIGNOFF) !== "not_held")
        }
        showRates={organisation.type === "agency" && can(CAPABILITIES.RATES_VIEW) !== "not_held"}
        showPricing={
          organisation.type === "agency" && can(CAPABILITIES.PRICING_VIEW) !== "not_held"
        }
        showPayroll={
          organisation.type === "agency" && can(CAPABILITIES.PAYROLL_VIEW) !== "not_held"
        }
        showInvoices={
          organisation.type === "agency" && can(CAPABILITIES.INVOICE_VIEW) !== "not_held"
        }
        showOperations={
          organisation.type === "agency" && can(CAPABILITIES.ASSIGNMENT_VIEW) !== "not_held"
        }
        showStaffingRequests={
          organisation.type === "facility" && can(CAPABILITIES.SHIFT_VIEW) !== "not_held"
        }
      />

      {myWorkerRecord ? (
        <Panel titleId="my-worker-heading" title={<>My worker record</>}>
          <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-md bg-surface-muted p-4 text-sm">
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <WorkerStatusBadge status={myWorkerRecord.status} />
            </dd>
            <dt className="text-muted-foreground">Start date</dt>
            <dd>{myWorkerRecord.startDate ?? "Not started"}</dd>
          </dl>
        </Panel>
      ) : null}

      {partnerRelationships.length > 0 ? (
        <Panel titleId="partners-heading" title={<>Agency relationships</>}>
          <RecordList label="Agency relationships">
            {partnerRelationships.map((relationship) => (
              <li key={relationship.relationshipId} className={RECORD_ROW}>
                <span className={cn("min-w-0 flex-1", RECORD_ROW_TITLE)}>
                  {relationship.agencyName}
                </span>
                <RelationshipStatusBadge status={relationship.status} />
              </li>
            ))}
          </RecordList>
          {sharedCompliance.length > 0 ? (
            // P0-E9-3K: the per-worker detail lives on the facility Compliance page.
            <p className={RECORD_ROW_META}>
              {sharedCompliance.reduce((sum, { workers }) => sum + workers.length, 0)} shared{" "}
              {sharedCompliance.reduce((sum, { workers }) => sum + workers.length, 0) === 1
                ? "worker"
                : "workers"}
              .{" "}
              <Link
                href={`/app/organisations/${organisationId}/compliance` as Route}
                className="text-primary underline underline-offset-4"
              >
                View compliance
              </Link>
            </p>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}
