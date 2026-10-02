import type { Metadata, Route } from "next";
import Link from "next/link";

import { Panel } from "@/components/ui/panel";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { KeyValueList } from "@/components/ui/key-value-list";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTabs } from "@/components/ui/section-tabs";
import {
  CreateLocationForm,
  createRelationshipAction,
  facilityIdSchema,
  FacilityForm,
  FacilityStatusBadge,
  getFacility,
  listFacilityTypes,
  listLocations,
  listRelationships,
  listTimezones,
  RelationshipStatusBadge,
  setFacilityStatusAction,
  setRelationshipStatusAction,
} from "@/features/facilities";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { GeofenceForm, listLocationGeofences } from "@/features/attendance";
import { listRequirements, RequirementForm, RequirementsTable } from "@/features/compliance";
import { localCalendarDate } from "@/lib/domain/credentials";
import { listCredentialTypes, listDisciplines, listJurisdictions } from "@/features/credentials";
import { CAPABILITIES } from "@/lib/authz";
import {
  FACILITY_STATUS_LABELS,
  FACILITY_STATUS_TRANSITIONS,
  RELATIONSHIP_STATUS_LABELS,
  RELATIONSHIP_STATUS_TRANSITIONS,
} from "@/lib/domain/vocabulary";

export const metadata: Metadata = { title: "Facility" };

const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

export default async function FacilityPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/facilities/[facilityId]">) {
  const { organisationId: rawOrganisationId, facilityId: rawFacilityId } = await params;
  const context = await loadOrganisationPage(rawOrganisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.FACILITY_VIEW);
  const facilityId = facilityIdSchema.safeParse(rawFacilityId);
  if (!facilityId.success) notFound();

  const { organisationId, organisation, can, needsStepUp } = context;
  const facility = await getFacility(organisationId, facilityId.data);
  if (!facility) notFound();

  const canViewRequirements = can(CAPABILITIES.CREDENTIAL_REQUIREMENTS_VIEW) === "granted";
  const canManageRequirements = can(CAPABILITIES.CREDENTIAL_REQUIREMENTS_MANAGE) === "granted";
  const [
    locations,
    relationships,
    facilityTypes,
    requirements,
    credentialTypes,
    disciplines,
    jurisdictions,
  ] = await Promise.all([
    listLocations(facility.id),
    can(CAPABILITIES.RELATIONSHIP_VIEW) === "granted"
      ? listRelationships(facility.id)
      : Promise.resolve([]),
    listFacilityTypes(),
    canViewRequirements ? listRequirements(organisationId, facility.id) : Promise.resolve([]),
    canViewRequirements ? listCredentialTypes() : Promise.resolve([]),
    canViewRequirements ? listDisciplines() : Promise.resolve([]),
    canManageRequirements ? listJurisdictions() : Promise.resolve([]),
  ]);
  const canManageFacility =
    can(CAPABILITIES.FACILITY_MANAGE) === "granted" && facility.status !== "archived";
  const canManageRelationship = can(CAPABILITIES.RELATIONSHIP_MANAGE) === "granted";
  const canManageGeofences = can(CAPABILITIES.ATTENDANCE_MANAGE_SETTINGS) === "granted";
  const geofences = canManageGeofences ? await listLocationGeofences(facility.id) : [];
  const openRelationship = relationships.find((relationship) => relationship.status !== "ended");
  const typeName =
    facilityTypes.find((type) => type.key === facility.facilityTypeKey)?.name ??
    facility.facilityTypeKey;
  const returnTo = `/app/organisations/${organisationId}/facilities/${facility.id}`;
  const timezones = canManageFacility ? listTimezones() : [];

  return (
    <>
      <PageHeader
        title={facility.name}
        back={
          <Link
            href={`/app/organisations/${organisationId}/facilities`}
            className="text-primary underline underline-offset-4"
          >
            {organisation.name} facilities
          </Link>
        }
        description={
          <p className="text-sm">
            {[typeName, facility.locality, facility.timezone].filter(Boolean).join(" · ")}
          </p>
        }
        meta={
          <>
            <FacilityStatusBadge status={facility.status} />
            {facility.linked ? (
              <span className="text-sm text-muted-foreground">
                Linked to a CHELTH facility organisation
              </span>
            ) : null}
          </>
        }
      />

      <SectionTabs
        label="Facility sections"
        tabs={[
          { label: "Details", href: "#details-heading" as Route, current: false },
          { label: "Locations", href: "#locations-heading" as Route, current: false },
          ...(canManageGeofences && locations.length > 0
            ? [{ label: "Location checks", href: "#geofence-heading" as Route, current: false }]
            : []),
          ...(canViewRequirements
            ? [{ label: "Requirements", href: "#requirements-heading" as Route, current: false }]
            : []),
          ...(can(CAPABILITIES.RELATIONSHIP_VIEW) === "granted"
            ? [
                {
                  label: "Agency relationship",
                  href: "#relationship-heading" as Route,
                  current: false,
                },
              ]
            : []),
          ...(canManageFacility
            ? [{ label: "Edit", href: "#edit-heading" as Route, current: false }]
            : []),
        ]}
      />

      {needsStepUp ? <StepUpNotice returnTo={returnTo} /> : null}

      <Panel titleId="details-heading" title={<>Details</>}>
        <KeyValueList
          className="max-w-2xl"
          items={[
            { label: "Type", value: typeName },
            { label: "Timezone", value: facility.timezone },
            {
              label: "Address",
              value:
                [
                  facility.addressLine1,
                  facility.addressLine2,
                  facility.locality,
                  facility.region,
                  facility.postalCode,
                  facility.countryCode,
                ]
                  .filter(Boolean)
                  .join(", ") || "—",
            },
            { label: "Phone", value: facility.phone ?? "—" },
            { label: "Email", value: facility.email ?? "—" },
            { label: "Your reference", value: facility.externalReference ?? "—" },
          ]}
        />
      </Panel>

      <Panel titleId="locations-heading" title={<>Locations</>}>
        {locations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No locations yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface text-sm">
            {locations.map((location) => (
              <li key={location.id} className="flex flex-wrap justify-between gap-2 p-3">
                <span className="font-medium">{location.name}</span>
                <span className="text-muted-foreground">{location.timezone}</span>
              </li>
            ))}
          </ul>
        )}
        {canManageFacility ? (
          <CreateLocationForm
            organisationId={organisationId}
            facilityId={facility.id}
            facilityTimezone={facility.timezone}
            timezones={timezones}
          />
        ) : null}
      </Panel>

      {canManageGeofences && locations.length > 0 ? (
        <Panel titleId="geofence-heading" title={<>Attendance location checks</>}>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Optional. When enabled for a location, workers share their location once when they clock
            in or out there. Chelth never tracks workers between clock actions.
          </p>
          {locations.map((location) => (
            <div key={location.id} className="flex flex-col gap-2">
              <h3 className="text-base font-semibold">{location.name}</h3>
              <GeofenceForm
                organisationId={organisationId}
                facilityId={facility.id}
                locationId={location.id}
                locationName={location.name}
                current={geofences.find((geofence) => geofence.locationId === location.id) ?? null}
              />
            </div>
          ))}
        </Panel>
      ) : null}

      {canViewRequirements ? (
        <Panel titleId="requirements-heading" title={<>Credential requirements</>}>
          <p className="text-sm text-muted-foreground">
            Added to the agency baseline for work at {facility.name}.
          </p>
          <RequirementsTable
            organisationId={organisationId}
            facilityId={facility.id}
            requirements={requirements}
            typeNames={new Map(credentialTypes.map((type) => [type.key, type.name]))}
            disciplineNames={
              new Map(disciplines.map((discipline) => [discipline.key, discipline.name]))
            }
            canManage={canManageRequirements}
            label={`${facility.name} credential requirements`}
            defaultLastDay={localCalendarDate(facility.timezone)}
          />
          {canManageRequirements && facility.status !== "archived" ? (
            <RequirementForm
              organisationId={organisationId}
              facilityId={facility.id}
              credentialTypes={credentialTypes}
              disciplines={disciplines}
              jurisdictions={jurisdictions.filter(
                (jurisdiction) => jurisdiction.level === "subdivision",
              )}
              defaultEffectiveFrom={localCalendarDate(facility.timezone)}
              effectiveFromHint={`Defaults to today at ${facility.name} (${facility.timezone}).`}
            />
          ) : null}
        </Panel>
      ) : null}

      {can(CAPABILITIES.RELATIONSHIP_VIEW) === "granted" ? (
        <Panel titleId="relationship-heading" title={<>Relationship</>}>
          {openRelationship ? (
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <RelationshipStatusBadge status={openRelationship.status} />
                {openRelationship.startedAt ? (
                  <span className="text-muted-foreground">
                    since {date.format(new Date(openRelationship.startedAt))}
                  </span>
                ) : null}
              </div>
              {canManageRelationship ? (
                <div className="flex flex-wrap gap-2">
                  {RELATIONSHIP_STATUS_TRANSITIONS[openRelationship.status].map((status) => (
                    <InlineActionForm
                      key={status}
                      action={setRelationshipStatusAction}
                      fields={{
                        organisationId,
                        facilityId: facility.id,
                        relationshipId: openRelationship.id,
                        status,
                      }}
                      label={
                        status === "active"
                          ? "Activate relationship"
                          : `Mark ${RELATIONSHIP_STATUS_LABELS[status].toLowerCase()}`
                      }
                      variant={status === "ended" ? "danger" : "outline"}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-muted-foreground">No open relationship with this facility.</p>
              {canManageRelationship && facility.status === "active" ? (
                <InlineActionForm
                  action={createRelationshipAction}
                  fields={{ organisationId, facilityId: facility.id }}
                  label="Start relationship"
                />
              ) : null}
            </div>
          )}
        </Panel>
      ) : null}

      {canManageFacility ? (
        <Panel titleId="edit-heading" title={<>Edit facility</>}>
          <FacilityForm
            organisationId={organisationId}
            facilityId={facility.id}
            facilityTypes={facilityTypes}
            timezones={timezones}
            values={{
              name: facility.name,
              facilityTypeKey: facility.facilityTypeKey,
              timezone: facility.timezone,
              phone: facility.phone ?? "",
              email: facility.email ?? "",
              addressLine1: facility.addressLine1 ?? "",
              addressLine2: facility.addressLine2 ?? "",
              locality: facility.locality ?? "",
              region: facility.region ?? "",
              postalCode: facility.postalCode ?? "",
              countryCode: facility.countryCode ?? "",
              externalReference: facility.externalReference ?? "",
            }}
          />
          <div className="flex flex-wrap gap-2">
            {FACILITY_STATUS_TRANSITIONS[facility.status].map((status) => (
              <InlineActionForm
                key={status}
                action={setFacilityStatusAction}
                fields={{ organisationId, facilityId: facility.id, status }}
                label={`Mark ${FACILITY_STATUS_LABELS[status].toLowerCase()}`}
                variant={status === "archived" ? "danger" : "outline"}
              />
            ))}
          </div>
        </Panel>
      ) : null}
    </>
  );
}
