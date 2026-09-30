import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import {
  AddWorkerNoteForm,
  getWorker,
  listWorkerNotes,
  setWorkerStatusAction,
  UpdateWorkerForm,
  workerIdSchema,
  WorkerStatusBadge,
} from "@/features/workforce";
import { CAPABILITIES } from "@/lib/authz";
import { WORKER_STATUS_LABELS, WORKER_STATUS_TRANSITIONS } from "@/lib/domain/vocabulary";

export const metadata: Metadata = { title: "Worker" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default async function WorkerPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/workforce/[workerId]">) {
  const { organisationId: rawOrganisationId, workerId: rawWorkerId } = await params;
  const context = await loadOrganisationPage(rawOrganisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.WORKER_VIEW);
  const workerId = workerIdSchema.safeParse(rawWorkerId);
  if (!workerId.success) notFound();

  const { organisationId, organisation, can } = context;
  const worker = await getWorker(organisationId, workerId.data);
  if (!worker) notFound();

  const canManage = can(CAPABILITIES.WORKER_MANAGE);
  const canReadNotes = can(CAPABILITIES.WORKER_NOTES_VIEW) === "granted";
  const notes = canReadNotes ? await listWorkerNotes(worker.id) : [];
  const returnTo = `/app/organisations/${organisationId}/workforce/${worker.id}`;

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}/workforce`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          {organisation.name} workforce
        </Link>
        <h1 className="text-2xl font-semibold">{worker.displayName ?? "Unnamed worker"}</h1>
        <div>
          <WorkerStatusBadge status={worker.status} />
        </div>
      </header>

      {canManage === "step_up_required" ? <StepUpNotice returnTo={returnTo} /> : null}

      <section aria-labelledby="record-heading" className="flex flex-col gap-3">
        <h2 id="record-heading" className="text-lg font-semibold">
          Worker record
        </h2>
        <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
          <dt className="text-muted-foreground">Reference</dt>
          <dd>{worker.workerReference ?? "—"}</dd>
          <dt className="text-muted-foreground">Start date</dt>
          <dd>{worker.startDate ?? "—"}</dd>
          <dt className="text-muted-foreground">End date</dt>
          <dd>{worker.endDate ?? "—"}</dd>
        </dl>
      </section>

      {canManage === "granted" && worker.status !== "terminated" ? (
        <section aria-labelledby="manage-heading" className="flex flex-col gap-4">
          <h2 id="manage-heading" className="text-lg font-semibold">
            Manage
          </h2>
          <div className="flex flex-wrap gap-2">
            {WORKER_STATUS_TRANSITIONS[worker.status].map((status) => (
              <InlineActionForm
                key={status}
                action={setWorkerStatusAction}
                fields={{ organisationId, workerId: worker.id, status }}
                label={`Set ${WORKER_STATUS_LABELS[status].toLowerCase()}`}
                variant={status === "terminated" ? "danger" : "outline"}
              />
            ))}
          </div>
          <UpdateWorkerForm
            organisationId={organisationId}
            workerId={worker.id}
            workerReference={worker.workerReference ?? ""}
          />
        </section>
      ) : null}

      {canReadNotes ? (
        <section aria-labelledby="notes-heading" className="flex flex-col gap-3">
          <h2 id="notes-heading" className="text-lg font-semibold">
            Internal notes
          </h2>
          {can(CAPABILITIES.WORKER_NOTES_MANAGE) === "granted" ? (
            <AddWorkerNoteForm organisationId={organisationId} workerId={worker.id} />
          ) : null}
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface text-sm">
              {notes.map((note) => (
                <li key={note.id} className="flex flex-col gap-1 p-3">
                  <p className="whitespace-pre-wrap">{note.body}</p>
                  <p className="text-xs text-muted-foreground">
                    {note.authorName ?? "A former colleague"} ·{" "}
                    {dateTime.format(new Date(note.createdAt))}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </>
  );
}
