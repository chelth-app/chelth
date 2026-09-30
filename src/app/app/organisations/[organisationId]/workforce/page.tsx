import type { Metadata } from "next";
import Link from "next/link";

import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { InviteWorkerForm, listWorkers, WorkerStatusBadge } from "@/features/workforce";
import { CAPABILITIES } from "@/lib/authz";

export const metadata: Metadata = { title: "Workforce" };

export default async function WorkforcePage({
  params,
}: PageProps<"/app/organisations/[organisationId]/workforce">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.WORKER_VIEW);
  const { organisationId, organisation, can } = context;
  const workers =
    can(CAPABILITIES.WORKER_VIEW) === "granted" ? await listWorkers(organisationId) : [];
  const inviteState = can(CAPABILITIES.MEMBERSHIP_INVITE);

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          {organisation.name}
        </Link>
        <h1 className="text-2xl font-semibold">Workforce</h1>
        <p className="text-sm text-muted-foreground">
          Healthcare professionals working with {organisation.name}. Each person&apos;s record here
          is specific to this agency.
        </p>
      </header>

      {inviteState === "granted" ? (
        <section aria-labelledby="invite-worker-heading" className="flex flex-col gap-3">
          <h2 id="invite-worker-heading" className="text-lg font-semibold">
            Invite a healthcare worker
          </h2>
          <InviteWorkerForm organisationId={organisationId} />
        </section>
      ) : inviteState === "step_up_required" ? (
        <StepUpNotice returnTo={`/app/organisations/${organisationId}/workforce`}>
          Inviting workers requires verification with your authenticator app.
        </StepUpNotice>
      ) : null}

      <section aria-labelledby="workers-heading" className="flex flex-col gap-3">
        <h2 id="workers-heading" className="text-lg font-semibold">
          Workers
        </h2>
        {workers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No workers yet. Invited workers appear here once they accept.
          </p>
        ) : (
          <div
            role="region"
            aria-labelledby="workers-heading"
            tabIndex={0}
            className="overflow-x-auto rounded-lg border border-border bg-surface"
          >
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="border-b border-border bg-surface-muted">
                <tr>
                  <th scope="col" className="p-3 font-medium">
                    Name
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    Reference
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    Started
                  </th>
                </tr>
              </thead>
              <tbody>
                {workers.map((worker) => (
                  <tr key={worker.id} className="border-b border-border last:border-0">
                    <th scope="row" className="p-3 font-medium">
                      <Link
                        href={`/app/organisations/${organisationId}/workforce/${worker.id}`}
                        className="text-primary underline underline-offset-4"
                      >
                        {worker.displayName ?? "Unnamed worker"}
                      </Link>
                    </th>
                    <td className="p-3">
                      <WorkerStatusBadge status={worker.status} />
                    </td>
                    <td className="p-3">{worker.workerReference ?? "—"}</td>
                    <td className="p-3">{worker.startDate ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
