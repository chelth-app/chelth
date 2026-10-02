import type { Metadata } from "next";
import Link from "next/link";

import {
  FacilityForm,
  FacilityStatusBadge,
  listFacilities,
  listFacilityTypes,
  listTimezones,
} from "@/features/facilities";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";

export const metadata: Metadata = { title: "Facilities" };

export default async function FacilitiesPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/facilities">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.FACILITY_VIEW);
  const { organisationId, organisation, can } = context;
  const canManage = can(CAPABILITIES.FACILITY_MANAGE);
  const [facilities, facilityTypes] = await Promise.all([
    can(CAPABILITIES.FACILITY_VIEW) === "granted"
      ? listFacilities(organisationId)
      : Promise.resolve([]),
    listFacilityTypes(),
  ]);
  const typeName = new Map(facilityTypes.map((type) => [type.key, type.name]));

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          {organisation.name}
        </Link>
        <h1 className="text-2xl font-semibold">Facilities</h1>
        <p className="text-sm text-muted-foreground">
          Client facilities {organisation.name} works with.
        </p>
      </header>

      <section aria-labelledby="facilities-heading" className="flex flex-col gap-3">
        <h2 id="facilities-heading" className="text-lg font-semibold">
          Client facilities
        </h2>
        {facilities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No client facilities yet.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {facilities.map((facility) => (
              <li
                key={facility.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
              >
                <Link
                  href={`/app/organisations/${organisationId}/facilities/${facility.id}`}
                  className="font-medium text-primary underline underline-offset-4"
                >
                  {facility.name}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {typeName.get(facility.facilityTypeKey) ?? facility.facilityTypeKey}
                  {facility.locality ? ` · ${facility.locality}` : ""} · {facility.timezone}
                </p>
                <div>
                  <FacilityStatusBadge status={facility.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage === "granted" ? (
        <section aria-labelledby="create-facility-heading" className="flex flex-col gap-3">
          <h2 id="create-facility-heading" className="text-lg font-semibold">
            Add a client facility
          </h2>
          <FacilityForm
            organisationId={organisationId}
            facilityTypes={facilityTypes}
            timezones={listTimezones()}
          />
        </section>
      ) : canManage === "step_up_required" ? (
        <StepUpNotice returnTo={`/app/organisations/${organisationId}/facilities`}>
          Adding or editing facilities requires verification with your authenticator app.
        </StepUpNotice>
      ) : null}
    </>
  );
}
