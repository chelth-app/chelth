import type { Metadata, Route } from "next";
import Link from "next/link";

import {
  RECORD_ROW,
  RECORD_ROW_META,
  RECORD_ROW_TITLE,
  RecordList,
  RecordNote,
  RecordPage,
} from "@/components/reference/record-page";
import { Panel } from "@/components/ui/panel";
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
import { FilterBar, FilterSelect } from "@/components/ui/filter-bar";
import { KeyValueList } from "@/components/ui/key-value-list";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTabs } from "@/components/ui/section-tabs";
import { StatusChip } from "@/components/ui/status-chip";
import {
  getReadiness,
  listComplianceShares,
  listWorkerDisciplines,
  ReadinessBadge,
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
import { cn } from "@/lib/utils/cn";
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
    // Locked Chelth visual system (docs/ui-reference/CHELTH-LOCKED-VISUAL-SYSTEM.md):
    // palette, panel surface, chips, tabs and CTAs are inherited through the scope.
    <RecordPage>
      <PageHeader
        variant="reference"
        title={worker.displayName ?? "Unnamed worker"}
        back={
          <Link
            href={`/app/organisations/${organisationId}/workforce`}
            className="text-primary underline underline-offset-4"
          >
            {organisation.name} workforce
          </Link>
        }
        description={
          <p>
            {[
              worker.workerReference ? `Reference ${worker.workerReference}` : null,
              worker.startDate ? `Started ${worker.startDate}` : "Not started",
              workerDisciplines.length > 0
                ? workerDisciplines.map((key) => disciplineName.get(key) ?? key).join(", ")
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        }
        meta={<WorkerStatusBadge status={worker.status} />}
      />

      <SectionTabs
        label="Worker record sections"
        tabs={[
          { label: "Record", href: "#record-heading" as Route, current: false },
          ...(canManage === "granted" && worker.status !== "terminated"
            ? [{ label: "Manage", href: "#manage-heading" as Route, current: false }]
            : []),
          ...(readiness
            ? [{ label: "Readiness", href: "#readiness-heading" as Route, current: false }]
            : []),
          ...(workerDisciplines.length > 0 || canManage === "granted"
            ? [{ label: "Disciplines", href: "#disciplines-heading" as Route, current: false }]
            : []),
          ...(can(CAPABILITIES.CREDENTIAL_VIEW) === "granted"
            ? [{ label: "Credentials", href: "#credentials-heading" as Route, current: false }]
            : []),
          ...(relationships.length > 0
            ? [
                {
                  label: "Facility sharing",
                  href: "#compliance-sharing-heading" as Route,
                  current: false,
                },
              ]
            : []),
          ...(canReadNotes
            ? [{ label: "Notes", href: "#notes-heading" as Route, current: false }]
            : []),
        ]}
      />

      {canManage === "step_up_required" ? <StepUpNotice returnTo={returnTo} /> : null}

      <Panel titleId="record-heading" title={<>Worker record</>}>
        <KeyValueList
          className="max-w-2xl"
          items={[
            { label: "Status", value: <WorkerStatusBadge status={worker.status} /> },
            { label: "Reference", value: worker.workerReference ?? "—" },
            { label: "Start date", value: worker.startDate ?? "—" },
            { label: "End date", value: worker.endDate ?? "—" },
            ...(readiness
              ? [
                  {
                    label: "Agency readiness",
                    value: <ReadinessBadge status={readiness.status} />,
                  },
                ]
              : []),
            ...(can(CAPABILITIES.CREDENTIAL_VIEW) === "granted"
              ? [{ label: "Credentials shared", value: credentials.length }]
              : []),
          ]}
        />
      </Panel>

      {canManage === "granted" && worker.status !== "terminated" ? (
        <Panel titleId="manage-heading" title={<>Manage</>}>
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
        </Panel>
      ) : null}

      {readiness ? (
        <Panel titleId="readiness-heading" title={<>Readiness</>}>
          <ReadinessPanel
            title={`${organisation.name} baseline`}
            readiness={readiness}
            headingId="agency-readiness"
          />
          {facilities.length > 0 ? (
            <FilterBar
              key={selectedFacility?.id ?? "none"}
              label="Facility readiness check"
              submitLabel="Check"
            >
              <FilterSelect
                label="Check readiness for a facility"
                id="readiness-facility"
                name="facility"
                defaultValue={selectedFacility?.id ?? ""}
              >
                <option value="">Choose a facility</option>
                {facilities.map((facility) => (
                  <option key={facility.id} value={facility.id}>
                    {facility.name}
                  </option>
                ))}
              </FilterSelect>
            </FilterBar>
          ) : null}
          {facilityReadiness && selectedFacility ? (
            <ReadinessPanel
              title={selectedFacility.name}
              readiness={facilityReadiness}
              headingId="facility-readiness"
            />
          ) : null}
        </Panel>
      ) : null}

      {workerDisciplines.length > 0 || canManage === "granted" ? (
        <Panel titleId="disciplines-heading" title={<>Disciplines</>}>
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
        </Panel>
      ) : null}

      {can(CAPABILITIES.CREDENTIAL_VIEW) === "granted" ? (
        <Panel
          titleId="credentials-heading"
          title={<>Credentials shared with {organisation.name}</>}
        >
          {credentials.length === 0 ? (
            <RecordNote>The worker has not shared any credentials with this agency.</RecordNote>
          ) : (
            <RecordList>
              {credentials.map((credential) => (
                <li key={credential.credentialId} className={cn(RECORD_ROW, "justify-between")}>
                  <Link
                    href={`/app/organisations/${organisationId}/workforce/${worker.id}/credentials/${credential.credentialId}`}
                    className="text-[15px] leading-5 font-semibold text-primary underline underline-offset-4"
                  >
                    {credential.typeName}
                    {credential.jurisdictionCode ? ` (${credential.jurisdictionCode})` : ""}
                  </Link>
                  <span className="flex flex-wrap items-center gap-2">
                    {credential.effectiveExpiryDate ? (
                      <span className={RECORD_ROW_META}>
                        expires {credential.effectiveExpiryDate}
                      </span>
                    ) : null}
                    {credential.latestVersionNumber === null ? (
                      <StatusChip tone="neutral">Not submitted</StatusChip>
                    ) : null}
                    {credential.latestVersionNumber !== null && !credential.documentsCleared ? (
                      <StatusChip tone="info">Document not cleared</StatusChip>
                    ) : null}
                    <VerificationBadge outcome={credential.agencyVerification} />
                  </span>
                </li>
              ))}
            </RecordList>
          )}
        </Panel>
      ) : null}

      {relationships.length > 0 ? (
        <Panel titleId="compliance-sharing-heading" title={<>Share readiness with a facility</>}>
          <RecordNote>
            A linked facility sees only readiness and reasons for workers you share with it — never
            documents, numbers or notes.
          </RecordNote>
          <RecordList>
            {relationships.map((relationship) => {
              const share = complianceShares.find(
                (item) => item.relationshipId === relationship.relationshipId,
              );
              return (
                <li key={relationship.relationshipId} className={cn(RECORD_ROW, "justify-between")}>
                  <span className={RECORD_ROW_TITLE}>{relationship.facilityName}</span>
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
          </RecordList>
        </Panel>
      ) : null}

      {canReadNotes ? (
        <Panel titleId="notes-heading" title={<>Internal notes</>}>
          {can(CAPABILITIES.WORKER_NOTES_MANAGE) === "granted" ? (
            <AddWorkerNoteForm organisationId={organisationId} workerId={worker.id} />
          ) : null}
          {notes.length === 0 ? (
            <RecordNote>No notes.</RecordNote>
          ) : (
            <RecordList>
              {notes.map((note) => (
                <li key={note.id} className={cn(RECORD_ROW, "flex-col items-start gap-1")}>
                  <p className="text-[14px] leading-5 font-medium whitespace-pre-wrap text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]">
                    {note.body}
                  </p>
                  <p className={RECORD_ROW_META}>
                    {note.authorName ?? "A former colleague"} ·{" "}
                    {dateTime.format(new Date(note.createdAt))}
                  </p>
                </li>
              ))}
            </RecordList>
          )}
        </Panel>
      ) : null}
    </RecordPage>
  );
}
