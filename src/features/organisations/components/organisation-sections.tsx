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
  showRates: boolean;
  showPricing: boolean;
  showPayroll: boolean;
  showInvoices: boolean;
  /**
   * Workspace staff navigate with the shell sidebar (P0-E8-S2 Overview
   * cleanup): list only the self-service links the sidebar does not carry.
   */
  selfServiceOnly?: boolean;
};

const LINK_CLASS =
  "rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-muted";

/** Section links for an organisation. Shown per capability (UI hint only). */
export function OrganisationSections({
  selfServiceOnly = false,
  ...all
}: OrganisationSectionsProps) {
  const props: Omit<OrganisationSectionsProps, "selfServiceOnly"> = selfServiceOnly
    ? {
        organisationId: all.organisationId,
        showMyShifts: all.showMyShifts,
        showMyCredentials: all.showMyCredentials,
        showWorkforce: false,
        showFacilities: false,
        showCompliance: false,
        showShifts: false,
        showStaffingRequests: false,
        showOperations: false,
        showAttendance: false,
        showTimesheets: false,
        showRates: false,
        showPricing: false,
        showPayroll: false,
        showInvoices: false,
      }
    : all;
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
    showRates,
    showPricing,
    showPayroll,
    showInvoices,
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
    !showTimesheets &&
    !showRates &&
    !showPricing &&
    !showPayroll &&
    !showInvoices
  )
    return null;
  return (
    <nav
      aria-label={selfServiceOnly ? "My work" : "Organisation sections"}
      className="flex flex-wrap gap-2"
    >
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
      {showPricing ? (
        <Link href={`/app/organisations/${organisationId}/pricing`} className={LINK_CLASS}>
          Pricing
        </Link>
      ) : null}
      {showPayroll ? (
        <Link href={`/app/organisations/${organisationId}/payroll`} className={LINK_CLASS}>
          Payroll
        </Link>
      ) : null}
      {showInvoices ? (
        <Link href={`/app/organisations/${organisationId}/invoices`} className={LINK_CLASS}>
          Invoices
        </Link>
      ) : null}
      {showRates ? (
        <Link href={`/app/organisations/${organisationId}/rates`} className={LINK_CLASS}>
          Rates
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
