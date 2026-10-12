import Link from "next/link";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import {
  REF_TABLE,
  REF_TEXT,
  RefChip,
  RefKpiCard,
  RefPanel,
} from "@/components/reference/locked-reference";
import { DataTableRegion } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { listSharedWorkerCompliance, ReadinessBadge } from "@/features/compliance";
import { listPartnerRelationships } from "@/features/facilities";
import { spell } from "@/features/localization";
import {
  COMPLIANCE_REASON_LABELS,
  type ComplianceSeverity,
  formatCalendarDate,
} from "@/lib/domain/credentials";
import { cn } from "@/lib/utils/cn";

import { LockedEmpty } from "../../(finance)/_components/finance-locked";

const SEVERITY_TONE: Record<ComplianceSeverity, "danger" | "warning" | "success"> = {
  blocking: "danger",
  warning: "warning",
  ok: "success",
};

/**
 * Facility Compliance (P0-E9-3K): the readiness of workers each partner
 * agency has shared with this facility, evaluated against this facility's
 * requirements by the one compliance engine (list_shared_worker_compliance —
 * audited per relationship). Requirement name, status and the date a
 * credential is valid to only: never documents, credential numbers or
 * workers an agency has not shared. Requirements themselves are set by the
 * agency on its facility record.
 */
export async function FacilityCompliance({
  organisationId,
  organisationName,
}: {
  organisationId: string;
  organisationName: string;
}) {
  const relationships = (await listPartnerRelationships(organisationId)).filter(
    (relationship) => relationship.status === "active",
  );
  const shared = await Promise.all(
    relationships.map(async (relationship) => ({
      relationship,
      workers: await listSharedWorkerCompliance(relationship.relationshipId),
    })),
  );
  const workers = shared.flatMap((entry) => entry.workers);
  const ready = workers.filter((worker) => worker.readiness === "ready").length;
  const attention = workers.length - ready;

  return (
    <div className="chelth-locked flex flex-col gap-[13px]">
      <PageHeader
        variant="reference"
        className="xl:mb-1"
        title="Compliance"
        back={
          <Link
            href={`/app/organisations/${organisationId}`}
            className="text-primary underline underline-offset-4"
          >
            {organisationName}
          </Link>
        }
        description={
          <p>
            Readiness of the workers your agencies share with you, checked against your facility
            requirements.
          </p>
        }
      />
      <section
        aria-label="Compliance summary"
        className="grid grid-cols-2 gap-3 xl:grid-cols-3 xl:gap-[13px]"
      >
        <RefKpiCard
          label="Workers Shared"
          value={workers.length}
          supporting={`From ${relationships.length} ${relationships.length === 1 ? "agency" : "agencies"}`}
          glyph="people"
          icon={<WorkspaceNavIcon name="workforce" strokeWidth={2.4} duotone />}
          tone="teal"
        />
        <RefKpiCard
          label="Ready"
          value={ready}
          supporting="Meet every requirement"
          glyph="document"
          icon={<WorkspaceNavIcon name="compliance" strokeWidth={2.4} duotone />}
          tone="teal"
        />
        <RefKpiCard
          label="Needs Attention"
          value={attention}
          supporting="Missing, expiring or awaiting review"
          glyph="alert"
          tone={attention > 0 ? "warning" : "info"}
        />
      </section>

      {shared.length === 0 ? (
        <RefPanel title="Shared workers" titleId="facility-compliance-heading">
          <LockedEmpty
            icon="compliance"
            title="No active agency relationships."
            note="When an agency works with your facility, the workers it shares appear here."
          />
        </RefPanel>
      ) : (
        shared.map(({ relationship, workers: agencyWorkers }) => (
          <RefPanel
            key={relationship.relationshipId}
            title={`Shared by ${relationship.agencyName}`}
            titleId={`facility-compliance-${relationship.relationshipId}`}
          >
            {agencyWorkers.length === 0 ? (
              <LockedEmpty
                icon="compliance"
                title="No workers shared yet."
                note={`${relationship.agencyName} shares a worker's compliance with you when they serve your facility.`}
              />
            ) : (
              <DataTableRegion
                aria-label={`Workers shared by ${relationship.agencyName} table`}
                className="rounded-none border-0 bg-transparent"
              >
                <table className={cn(REF_TABLE, "min-w-[40rem]")}>
                  <caption className="sr-only">Workers shared by {relationship.agencyName}</caption>
                  <thead className={REF_TEXT.tableHead}>
                    <tr>
                      <th scope="col">Worker</th>
                      <th scope="col">Readiness</th>
                      <th scope="col">Requirements</th>
                    </tr>
                  </thead>
                  <tbody className={REF_TEXT.tableBody}>
                    {agencyWorkers.map((worker) => (
                      <tr key={worker.workerId} className="align-top">
                        <td className="py-2.5 font-medium text-chelth-navy">
                          {worker.workerName ?? "Worker"}
                        </td>
                        <td className="py-2.5">
                          <ReadinessBadge status={worker.readiness} />
                        </td>
                        <td className="py-2.5">
                          <ul className="flex flex-col gap-1.5">
                            {worker.items.map((item, index) => (
                              <li
                                key={`${item.credentialTypeName}-${index}`}
                                className="flex flex-wrap items-center gap-x-2 gap-y-1"
                              >
                                <span>{item.credentialTypeName}</span>
                                <RefChip
                                  tone={SEVERITY_TONE[item.severity]}
                                  className="font-normal"
                                >
                                  {spell(COMPLIANCE_REASON_LABELS[item.reason])}
                                </RefChip>
                                {item.effectiveExpiryDate ? (
                                  <span className="text-muted-foreground">
                                    Valid to {formatCalendarDate(item.effectiveExpiryDate)}
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DataTableRegion>
            )}
          </RefPanel>
        ))
      )}
    </div>
  );
}
