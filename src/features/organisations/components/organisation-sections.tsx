import Link from "next/link";

type OrganisationSectionsProps = {
  organisationId: string;
  showWorkforce: boolean;
  showFacilities: boolean;
};

/** Section links for an organisation. Shown per capability (UI hint only). */
export function OrganisationSections({
  organisationId,
  showWorkforce,
  showFacilities,
}: OrganisationSectionsProps) {
  if (!showWorkforce && !showFacilities) return null;
  return (
    <nav aria-label="Organisation sections" className="flex flex-wrap gap-2">
      {showWorkforce ? (
        <Link
          href={`/app/organisations/${organisationId}/workforce`}
          className="rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-muted"
        >
          Workforce
        </Link>
      ) : null}
      {showFacilities ? (
        <Link
          href={`/app/organisations/${organisationId}/facilities`}
          className="rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-muted"
        >
          Facilities
        </Link>
      ) : null}
    </nav>
  );
}
