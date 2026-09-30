import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { loadOrganisationPage } from "@/features/organisations";
import {
  acceptAssignmentAction,
  AssignmentStatusBadge,
  declineAssignmentAction,
  listMyShiftAssignments,
  ShiftStatusBadge,
} from "@/features/shifts";
import { getMyWorkerRecord } from "@/features/workforce";
import {
  ASSIGNMENT_CANCELLATION_REASON_LABELS,
  formatShiftDate,
  formatShiftTimeRange,
} from "@/lib/domain/shifts";

export const metadata: Metadata = { title: "My shifts" };

/** The worker's own assignments at one agency. Nobody else's are ever shown. */
export default async function MyShiftsPage({
  params,
}: PageProps<"/app/organisations/[organisationId]/my-shifts">) {
  const { organisationId, organisation } = await loadOrganisationPage(
    (await params).organisationId,
  );
  const worker = await getMyWorkerRecord(organisationId);
  if (!worker) notFound();
  const assignments = await listMyShiftAssignments(organisationId);

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/organisations/${organisationId}`}
          className="w-fit text-sm text-primary underline underline-offset-4"
        >
          {organisation.name}
        </Link>
        <h1 className="text-2xl font-semibold">My shifts</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Shifts {organisation.name} has assigned to you. Times are in the facility&apos;s timezone.
          Accept to confirm you will work the shift, or decline if you cannot.
        </p>
      </header>

      <section aria-labelledby="my-shifts-heading" className="flex flex-col gap-3">
        <h2 id="my-shifts-heading" className="text-lg font-semibold">
          Assignments
        </h2>
        {assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">You have no assignments yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {assignments.map((assignment) => (
              <li
                key={assignment.id}
                aria-label={`${assignment.facilityName} ${formatShiftDate(assignment)}`}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {assignment.facilityName} · {assignment.disciplineName}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <AssignmentStatusBadge status={assignment.status} />
                    {assignment.shiftStatus !== "open" ? (
                      <ShiftStatusBadge status={assignment.shiftStatus} />
                    ) : null}
                  </div>
                </div>
                <p className="text-sm">
                  {formatShiftDate(assignment)} · {formatShiftTimeRange(assignment)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {assignment.locationName} · {assignment.timezone}
                </p>
                {assignment.instructions ? (
                  <p className="text-sm whitespace-pre-line">
                    <span className="font-medium">Instructions: </span>
                    {assignment.instructions}
                  </p>
                ) : null}
                {assignment.cancellationReason ? (
                  <p className="text-sm text-muted-foreground">
                    {ASSIGNMENT_CANCELLATION_REASON_LABELS[assignment.cancellationReason]}
                  </p>
                ) : null}
                {assignment.canRespond ? (
                  <div className="flex flex-wrap gap-2">
                    <InlineActionForm
                      action={acceptAssignmentAction}
                      fields={{ organisationId, assignmentId: assignment.id }}
                      label="Accept"
                      accessibleLabel={`Accept shift at ${assignment.facilityName}`}
                      variant="primary"
                    />
                    <InlineActionForm
                      action={declineAssignmentAction}
                      fields={{ organisationId, assignmentId: assignment.id }}
                      label="Decline"
                      accessibleLabel={`Decline shift at ${assignment.facilityName}`}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
