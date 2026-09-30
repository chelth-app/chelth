import Link from "next/link";

type OrganisationSectionsProps = {
  organisationId: string;
  showWorkforce: boolean;
  showFacilities: boolean;
  showCompliance: boolean;
  showMyCredentials: boolean;
  showShifts: boolean;
  showMyShifts: boolean;
  showStaffingRequests: boolean;
  showOperations: boolean;
  showAttendance: boolean;
  showTimesheets: boolean;
};

const LINK_CLASS =
  "rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-muted";

/** Section links for an organisation. Shown per capability (UI hint only). */
export function OrganisationSections(props: OrganisationSectionsProps) {
  const {
    organisationId,
    showWorkforce,
    showFacilities,
    showCompliance,
    showMyCredentials,
    showShifts,
    showMyShifts,
    showStaffingRequests,
    showOperations,
    showAttendance,
    showTimesheets,
  } = props;
  if (
    !showWorkforce &&
    !showFacilities &&
    !showCompliance &&
    !showMyCredentials &&
    !showShifts &&
    !showMyShifts &&
    !showStaffingRequests &&
    !showOperations &&
    !showAttendance &&
    !showTimesheets
  )
    return null;
  return (
    <nav aria-label="Organisation sections" className="flex flex-wrap gap-2">
      {showShifts ? (
        <Link href={`/app/organisations/${organisationId}/shifts`} className={LINK_CLASS}>
          Shifts
        </Link>
      ) : null}
      {showOperations ? (
        <Link href={`/app/organisations/${organisationId}/operations`} className={LINK_CLASS}>
          Operations
        </Link>
      ) : null}
      {showAttendance ? (
        <Link href={`/app/organisations/${organisationId}/attendance`} className={LINK_CLASS}>
          Attendance
        </Link>
      ) : null}
      {showTimesheets ? (
        <Link href={`/app/organisations/${organisationId}/timesheets`} className={LINK_CLASS}>
          Timesheets
        </Link>
      ) : null}
      {showStaffingRequests ? (
        <Link
          href={`/app/organisations/${organisationId}/staffing-requests`}
          className={LINK_CLASS}
        >
          Staffing requests
        </Link>
      ) : null}
      {showMyShifts ? (
        <Link href={`/app/organisations/${organisationId}/my-shifts`} className={LINK_CLASS}>
          My shifts
        </Link>
      ) : null}
      {showWorkforce ? (
        <Link href={`/app/organisations/${organisationId}/workforce`} className={LINK_CLASS}>
          Workforce
        </Link>
      ) : null}
      {showFacilities ? (
        <Link href={`/app/organisations/${organisationId}/facilities`} className={LINK_CLASS}>
          Facilities
        </Link>
      ) : null}
      {showCompliance ? (
        <Link href={`/app/organisations/${organisationId}/compliance`} className={LINK_CLASS}>
          Credential requirements
        </Link>
      ) : null}
      {showMyCredentials ? (
        <Link href={`/app/organisations/${organisationId}/my-credentials`} className={LINK_CLASS}>
          My credentials
        </Link>
      ) : null}
    </nav>
  );
}
