import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineActionForm } from "@/components/forms/inline-action-form";
import { PageHeader } from "@/components/ui/page-header";
import { AttendanceStateBadge, listMyAttendance, type MyAttendance } from "@/features/attendance";
import { facilityImageUrl } from "@/features/facilities";
import { loadOrganisationPage } from "@/features/organisations";
import {
  acceptAssignmentAction,
  AssignmentStatusBadge,
  declineAssignmentAction,
  listMyShiftAssignments,
  listMyShiftOffers,
  type MyShiftAssignment,
  OfferStatusBadge,
  RespondToOffer,
  ShiftStatusBadge,
} from "@/features/shifts";
import { getMyWorkerRecord } from "@/features/workforce";
import { formatShiftDate, formatShiftTimeRange, shiftPeriod } from "@/lib/domain/shifts";

import { PeriodTabs } from "./_components/period-tabs";
import { ShiftCard, ShiftRow } from "./_components/shift-card";
import { FactRows, ShiftIdentity, WORKER_CARD, WorkerEmpty } from "./_components/worker-cards";

export const metadata: Metadata = { title: "My Shifts" };

const isOpen = (status: string) => status === "open" || status === "under_review";
const isActive = (assignment: MyShiftAssignment) =>
  assignment.status === "assigned" || assignment.status === "accepted";

/**
 * The worker's home at one agency (canonical Worker Mobile screen 1,
 * P0-E9-3D-S2): Today / Upcoming / Past over the worker's own assignments in
 * each facility's local calendar (server-derived), offers to answer, and the
 * next shift. Attendance, directions, contact and requirements live on Shift
 * Details. Nobody else's data is ever read.
 */
export default async function MyShiftsPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/my-shifts">) {
  const { organisationId } = await loadOrganisationPage((await params).organisationId);
  const worker = await getMyWorkerRecord(organisationId);
  if (!worker) notFound();
  const [assignments, offers, attendance] = await Promise.all([
    listMyShiftAssignments(organisationId),
    listMyShiftOffers(organisationId),
    listMyAttendance(organisationId),
  ]);
  const view = (await searchParams).view;
  const period = view === "upcoming" || view === "past" ? view : "today";
  const base = `/app/organisations/${organisationId}/my-shifts`;

  // Signed photo URLs for the facilities on screen (only active assignments carry a path).
  const paths = [
    ...new Set(assignments.flatMap((item) => (item.imagePath ? [item.imagePath] : []))),
  ];
  const urls = new Map(
    await Promise.all(paths.map(async (path) => [path, await facilityImageUrl(path)] as const)),
  );
  const imageOf = (assignment: MyShiftAssignment) =>
    assignment.imagePath ? (urls.get(assignment.imagePath) ?? null) : null;
  const attendanceOf = new Map(attendance.map((item) => [item.assignmentId, item]));

  const byStart = (a: MyShiftAssignment, b: MyShiftAssignment) =>
    a.startAt.localeCompare(b.startAt);
  const groups = {
    today: assignments.filter((item) => shiftPeriod(item) === "today").sort(byStart),
    upcoming: assignments.filter((item) => shiftPeriod(item) === "upcoming").sort(byStart),
    past: assignments.filter((item) => shiftPeriod(item) === "past"),
  };
  const todayActive = groups.today.filter(isActive);
  const upcomingActive = groups.upcoming.filter(isActive);
  const next = todayActive.length === 0 ? upcomingActive[0] : undefined;

  const chipsFor = (assignment: MyShiftAssignment, item?: MyAttendance) => (
    <>
      {item && item.clockState !== "not_started" ? (
        <AttendanceStateBadge
          clockState={item.clockState}
          needsReview={item.exceptions.some((exception) => isOpen(exception.status))}
        />
      ) : (
        <AssignmentStatusBadge status={assignment.status} />
      )}
      {assignment.shiftStatus !== "open" ? (
        <ShiftStatusBadge status={assignment.shiftStatus} />
      ) : null}
    </>
  );
  const respond = (assignment: MyShiftAssignment) =>
    assignment.canRespond ? (
      <div className="grid grid-cols-2 gap-2">
        <InlineActionForm
          action={acceptAssignmentAction}
          fields={{ organisationId, assignmentId: assignment.id }}
          label="Accept"
          accessibleLabel={`Accept shift at ${assignment.facilityName}`}
          variant="primary"
          buttonClassName="h-12 w-full rounded-[8px] text-[15px] sm:h-12"
        />
        <InlineActionForm
          action={declineAssignmentAction}
          fields={{ organisationId, assignmentId: assignment.id }}
          label="Decline"
          accessibleLabel={`Decline shift at ${assignment.facilityName}`}
          buttonClassName="h-12 w-full rounded-[8px] text-[15px] sm:h-12"
        />
      </div>
    ) : null;
  const card = (assignment: MyShiftAssignment) => (
    <ShiftCard
      key={assignment.id}
      assignment={assignment}
      imageUrl={imageOf(assignment)}
      href={`${base}/${assignment.id}`}
      chips={chipsFor(assignment, attendanceOf.get(assignment.id))}
      actions={respond(assignment)}
    />
  );

  return (
    <div className="chelth-locked flex flex-col gap-5">
      <PageHeader variant="reference" title="My Shifts" />
      <PeriodTabs base={base} current={period} />

      {period !== "past" && offers.length > 0 ? (
        <Section id="my-offers-heading" title="Shift offers">
          <ul aria-label="Shift offers" className="flex flex-col gap-3">
            {offers.map((offer) => (
              <li
                key={offer.id}
                aria-label={`Offer: ${offer.facilityName} ${formatShiftDate(offer)}`}
                className={WORKER_CARD}
              >
                <ShiftIdentity
                  title={offer.facilityName}
                  subtitle={offer.disciplineName}
                  chips={<OfferStatusBadge status={offer.status} />}
                />
                <FactRows
                  rows={[
                    { icon: "shifts", label: "Date", value: formatShiftDate(offer) },
                    { icon: "attendance", label: "Time", value: formatShiftTimeRange(offer) },
                    { icon: "pin", label: "Location", value: offer.locationName },
                  ]}
                />
                {offer.canRespond ? (
                  <>
                    <p className="text-[13px] leading-[18px] text-slate-600">
                      Respond by{" "}
                      {formatShiftDate({ startAt: offer.expiresAt, timezone: offer.timezone })},{" "}
                      {new Intl.DateTimeFormat("en-US", {
                        timeZone: offer.timezone,
                        hour: "numeric",
                        minute: "2-digit",
                        timeZoneName: "short",
                      }).format(new Date(offer.expiresAt))}
                      . Accepting assigns you only if the shift still has a place and you still meet
                      its requirements.
                    </p>
                    <RespondToOffer
                      organisationId={organisationId}
                      offerId={offer.id}
                      facilityName={offer.facilityName}
                    />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {period === "today" ? (
        <>
          {groups.today.length > 0 ? (
            <Section id="today-heading" title="Today">
              <ul aria-label="My assignments" className="flex flex-col gap-3">
                {groups.today.map(card)}
              </ul>
            </Section>
          ) : next ? (
            <Section id="next-heading" title="Next Shift">
              <ul aria-label="My assignments" className="flex flex-col gap-3">
                {card(next)}
              </ul>
            </Section>
          ) : (
            <WorkerEmpty
              title={assignments.length === 0 ? "You have no assignments yet." : "No shifts today."}
              note="New assignments and accepted offers appear here."
            />
          )}
          {upcomingActive.filter((item) => item !== next).length > 0 ? (
            <Section
              id="upcoming-heading"
              title="Upcoming Shifts"
              action={
                <Link
                  href={`${base}?view=upcoming` as Route}
                  className="inline-flex min-h-11 items-center text-[14px] font-semibold text-primary"
                >
                  View all<span className="sr-only"> upcoming shifts</span>
                </Link>
              }
            >
              <ul aria-label="Upcoming shifts" className="flex flex-col gap-2.5">
                {upcomingActive
                  .filter((item) => item !== next)
                  .slice(0, 3)
                  .map((assignment) => (
                    <ShiftRow
                      key={assignment.id}
                      assignment={assignment}
                      imageUrl={imageOf(assignment)}
                      href={`${base}/${assignment.id}`}
                    />
                  ))}
              </ul>
            </Section>
          ) : null}
        </>
      ) : period === "upcoming" ? (
        groups.upcoming.length === 0 ? (
          <WorkerEmpty
            title="You have no upcoming assignments."
            note="New assignments and accepted offers appear here."
          />
        ) : (
          <ul aria-label="My assignments" className="flex flex-col gap-3">
            {groups.upcoming.map(card)}
          </ul>
        )
      ) : groups.past.length === 0 ? (
        <WorkerEmpty title="No past assignments." note="Shifts move here after their day." />
      ) : (
        <ul aria-label="My assignments" className="flex flex-col gap-2.5">
          {groups.past.map((assignment) => (
            <ShiftRow
              key={assignment.id}
              assignment={assignment}
              imageUrl={imageOf(assignment)}
              href={`${base}/${assignment.id}`}
              chip={chipsFor(assignment, attendanceOf.get(assignment.id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Section({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2
          id={id}
          className="font-display text-[19px] leading-[26px] font-semibold text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]"
        >
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
