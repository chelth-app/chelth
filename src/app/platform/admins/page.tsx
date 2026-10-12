import type { Metadata } from "next";

import { DataTableRegion } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { listPlatformAdmins } from "@/features/platform";

import { PLATFORM_TABLE, platformDate } from "../_components/platform-ui";

export const metadata: Metadata = { title: "Platform admins" };

/**
 * Platform administrators (P0-E9-4A), read-only. Granting and revoking stay
 * an operator procedure run by the database owner (audited), deliberately
 * not reachable from the app: a compromised session can never mint another
 * platform admin.
 */
export default async function PlatformAdminsPage() {
  const admins = await listPlatformAdmins();
  return (
    <>
      <PageHeader
        variant="reference"
        title="Platform admins"
        description={<p>People who can administer Chelth customers. Not tenant members.</p>}
      />
      <Panel titleId="admins-heading" title={<>Grants</>} variant="reference">
        <DataTableRegion aria-label="Platform admins table">
          <table className={PLATFORM_TABLE}>
            <caption className="sr-only">Platform admins</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Granted</th>
                <th scope="col">Granted by</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => (
                <tr key={admin.grantId}>
                  <td>{admin.displayName ?? "—"}</td>
                  <td>{admin.email ?? "—"}</td>
                  <td>{platformDate(admin.grantedAt)}</td>
                  <td>{admin.grantedBy}</td>
                  <td>
                    <StatusChip tone={admin.active ? "success" : "neutral"}>
                      {admin.active ? "Active" : `Revoked ${platformDate(admin.revokedAt)}`}
                    </StatusChip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableRegion>
      </Panel>
      <Panel
        titleId="grant-heading"
        title={<>Granting or revoking</>}
        description={<>An operator procedure, run by the database owner and audited.</>}
        variant="reference"
      >
        <p className="text-sm text-slate-700">
          Follow docs/runbooks/PILOT_OPERATIONS.md §10. The person must already have a Chelth
          account with an authenticator app. Always record the operator and a reason. Revoking takes
          effect on their next request.
        </p>
      </Panel>
    </>
  );
}
