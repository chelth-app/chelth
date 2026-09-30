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
import { Badge } from "@/components/ui/badge";
import {
  getReadiness,
  listComplianceShares,
  listWorkerDisciplines,
  ReadinessPanel,
  revokeComplianceShareAction,
  setDisciplineAction,
  shareComplianceAction,
} from "@/features/compliance";
import {
  listAgencyWorkerCredentials,
  listDisciplines,
  VerificationBadge,
} from "@/features/credentials";
import { listActiveRelationships, listFacilities } from "@/features/facilities";
import { CAPABILITIES } from "@/lib/authz";
import { WORKER_STATUS_LABELS, WORKER_STATUS_TRANSITIONS } from "@/lib/domain/vocabulary";

export const metadata: Metadata = { title: "Worker" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default async function WorkerPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/workforce/[workerId]">) {
  const { organisationId: rawOrganisationId, workerId: rawWorkerId } = await params;
  const { facility: rawFacility } = await searchParams;
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

  // Compliance (derived by the database) and credentials (shared only).
  const canCompliance = can(CAPABILITIES.COMPLIANCE_VIEW) === "granted";
  const facilities =
    can(CAPABILITIES.FACILITY_VIEW) === "granted" ? await listFacilities(organisationId) : [];
  const selectedFacility = facilities.find((facility) => facility.id === rawFacility);
  const [
    readiness,
    facilityReadiness,
    credentials,
    disciplines,
    workerDisciplines,
    relationships,
    complianceShares,
  ] = await Promise.all([
    canCompliance ? getReadiness(worker.id) : Promise.resolve(null),
    canCompliance && selectedFacility
      ? getReadiness(worker.id, selectedFacility.id)
      : Promise.resolve(null),
    can(CAPABILITIES.CREDENTIAL_VIEW) === "granted"
      ? listAgencyWorkerCredentials(worker.id)
      : Promise.resolve([]),
    listDisciplines(),
    canCompliance || can(CAPABILITIES.WORKER_VIEW) === "granted"
      ? listWorkerDisciplines(worker.id)
      : Promise.resolve([]),
    can(CAPABILITIES.CREDENTIAL_VERIFY) === "granted" &&
    can(CAPABILITIES.RELATIONSHIP_VIEW) === "granted"
      ? listActiveRelationships(organisationId)
      : Promise.resolve([]),
    can(CAPABILITIES.CREDENTIAL_VERIFY) === "granted"
      ? listComplianceShares(worker.id)
      : Promise.resolve([]),
  ]);
  const disciplineName = new Map(
    disciplines.map((discipline) => [discipline.key, discipline.name]),
  );
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

      {readiness ? (
        <section aria-labelledby="readiness-heading" className="flex flex-col gap-3">
          <h2 id="readiness-heading" className="text-lg font-semibold">
            Readiness
          </h2>
          <ReadinessPanel
            title={`${organisation.name} baseline`}
            readiness={readiness}
            headingId="agency-readiness"
          />
          {facilities.length > 0 ? (
            <form className="flex flex-wrap items-end gap-2" method="get">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Check readiness for a facility</span>
                <select
                  name="facility"
                  defaultValue={selectedFacility?.id ?? ""}
                  className="h-10 rounded-md border border-input-border bg-surface px-2"
                >
                  <option value="">Choose a facility</option>
                  {facilities.map((facility) => (
                    <option key={facility.id} value={facility.id}>
                      {facility.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="h-10 rounded-md border border-input-border bg-surface px-3 text-sm font-medium"
              >
                Check
              </button>
            </form>
          ) : null}
          {facilityReadiness && selectedFacility ? (
            <ReadinessPanel
              title={selectedFacility.name}
              readiness={facilityReadiness}
              headingId="facility-readiness"
            />
          ) : null}
        </section>
      ) : null}

      {workerDisciplines.length > 0 || canManage === "granted" ? (
        <section aria-labelledby="disciplines-heading" className="flex flex-col gap-3">
          <h2 id="disciplines-heading" className="text-lg font-semibold">
            Disciplines
          </h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {disciplines.map((discipline) => {
              const assigned = workerDisciplines.includes(discipline.key);
              if (!assigned && canManage !== "granted") return null;
              return (
                <li key={discipline.key} className="flex items-center gap-1">
                  {canManage === "granted" ? (
                    <InlineActionForm
                      action={setDisciplineAction}
                      fields={{
                        organisationId,
                        workerId: worker.id,
                        disciplineKey: discipline.key,
                        assigned: String(!assigned),
                      }}
                      label={assigned ? `✓ ${discipline.name}` : discipline.name}
                      accessibleLabel={`${assigned ? "Remove" : "Add"} discipline ${discipline.name}`}
                      variant={assigned ? "primary" : "outline"}
                    />
                  ) : (
                    <Badge tone="info">{disciplineName.get(discipline.key)}</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {can(CAPABILITIES.CREDENTIAL_VIEW) === "granted" ? (
        <section aria-labelledby="credentials-heading" className="flex flex-col gap-3">
          <h2 id="credentials-heading" className="text-lg font-semibold">
            Credentials shared with {organisation.name}
          </h2>
          {credentials.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The worker has not shared any credentials with this agency.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface text-sm">
              {credentials.map((credential) => (
                <li
                  key={credential.credentialId}
                  className="flex flex-wrap items-center justify-between gap-2 p-3"
                >
                  <Link
                    href={`/app/organisations/${organisationId}/workforce/${worker.id}/credentials/${credential.credentialId}`}
                    className="font-medium text-primary underline underline-offset-4"
                  >
                    {credential.typeName}
                    {credential.jurisdictionCode ? ` (${credential.jurisdictionCode})` : ""}
                  </Link>
                  <span className="flex flex-wrap items-center gap-2">
                    {credential.effectiveExpiryDate ? (
                      <span className="text-muted-foreground">
                        expires {credential.effectiveExpiryDate}
                      </span>
                    ) : null}
                    {credential.latestVersionNumber === null ? (
                      <Badge tone="neutral">Not submitted</Badge>
                    ) : null}
                    {credential.latestVersionNumber !== null && !credential.documentsCleared ? (
                      <Badge tone="info">Document not cleared</Badge>
                    ) : null}
                    <VerificationBadge outcome={credential.agencyVerification} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {relationships.length > 0 ? (
        <section aria-labelledby="compliance-sharing-heading" className="flex flex-col gap-3">
          <h2 id="compliance-sharing-heading" className="text-lg font-semibold">
            Share readiness with a facility
          </h2>
          <p className="text-sm text-muted-foreground">
            A linked facility sees only readiness and reasons for workers you share with it — never
            documents, numbers or notes.
          </p>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface text-sm">
            {relationships.map((relationship) => {
              const share = complianceShares.find(
                (item) => item.relationshipId === relationship.relationshipId,
              );
              return (
                <li
                  key={relationship.relationshipId}
                  className="flex flex-wrap items-center justify-between gap-2 p-3"
                >
                  <span>{relationship.facilityName}</span>
                  {share ? (
                    <InlineActionForm
                      action={revokeComplianceShareAction}
                      fields={{ organisationId, workerId: worker.id, shareId: share.id }}
                      label="Stop sharing"
                      accessibleLabel={`Stop sharing readiness with ${relationship.facilityName}`}
                      variant="ghost"
                    />
                  ) : (
                    <InlineActionForm
                      action={shareComplianceAction}
                      fields={{
                        organisationId,
                        workerId: worker.id,
                        relationshipId: relationship.relationshipId,
                      }}
                      label="Share readiness"
                      accessibleLabel={`Share readiness with ${relationship.facilityName}`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
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
