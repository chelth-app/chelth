import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { RefChip } from "@/components/reference/locked-reference";
import { LocationPin } from "@/components/ui/location-pin";
import type { StatusTone } from "@/components/ui/status-chip";
import {
  FACILITY_TONE,
  type FacilityDetail,
  type FacilityLocation,
  RELATIONSHIP_TONE,
  type Relationship,
} from "@/features/facilities";
import { type AgencyShiftSummary, FILL_TONE, SHIFT_TONE } from "@/features/shifts";
import {
  disciplineNameParts,
  FILL_STATE_LABELS,
  formatShiftDate,
  formatShiftTimeRangeParts,
  SHIFT_STATUS_LABELS,
} from "@/lib/domain/shifts";
import { FACILITY_STATUS_LABELS, RELATIONSHIP_STATUS_LABELS } from "@/lib/domain/vocabulary";
import { cn } from "@/lib/utils/cn";

import { DetailsTabs } from "@/components/reference/details-tabs";

/*
 * Facility Details — the canonical Chelth drawer (docs/ui-reference/
 * CHELTH-LOCKED-VISUAL-SYSTEM.md, C) with Facilities content. Only data the
 * product holds: the facility record (type, address, phone, email), its
 * locations, the relationship lifecycle and real upcoming shifts / facility
 * requests. No contact person, units, activity feed or messaging exist.
 */

const INK = "text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]";

function shiftChip(shift: AgencyShiftSummary): { tone: StatusTone; label: string } {
  if (shift.status === "open") {
    return shift.fillState === "unfilled"
      ? { tone: "danger", label: "Open" }
      : { tone: FILL_TONE[shift.fillState], label: FILL_STATE_LABELS[shift.fillState] };
  }
  return { tone: SHIFT_TONE[shift.status], label: SHIFT_STATUS_LABELS[shift.status] };
}

function Section({
  id,
  title,
  action,
  children,
  divided = true,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  divided?: boolean;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "flex flex-col gap-2.5 py-3.5",
        divided && "border-t border-[rgba(18,107,103,0.12)]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={id} className={cn("text-[16px] leading-[22px] font-semibold", INK)}>
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function IconTile({ tone = "teal", children }: { tone?: "teal" | "neutral"; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] [&>svg]:size-[19px]",
        tone === "teal"
          ? "bg-[linear-gradient(145deg,#e6f9f3,#ccefe3)] text-chelth-teal-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
          : "bg-surface-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function QuietEmpty({ icon, title, note }: { icon: ReactNode; title: string; note: string }) {
  return (
    <div className="flex items-center gap-3">
      <IconTile tone="neutral">{icon}</IconTile>
      <span className="flex flex-col">
        <span className="text-[14px] leading-5 font-medium text-slate-600">{title}</span>
        <span className="text-[12.5px] leading-[18px] text-muted-foreground">{note}</span>
      </span>
    </div>
  );
}

function ShiftRow({ shift, href }: { shift: AgencyShiftSummary; href: Route }) {
  const { range } = formatShiftTimeRangeParts(shift);
  const chip = shiftChip(shift);
  const role = disciplineNameParts(shift.disciplineName);
  return (
    <li>
      <Link
        href={href}
        className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg py-1 hover:bg-[#f4fbf9]"
      >
        <IconTile>
          <WorkspaceNavIcon name="shifts" strokeWidth={2.1} />
        </IconTile>
        <span className="flex min-w-0 flex-col">
          <span className={cn("text-[13.5px] leading-[19px] font-semibold", INK)}>
            {formatShiftDate(shift)} · {range}
          </span>
          <span className="truncate text-[12.5px] leading-[18px] text-slate-600">
            {shift.locationName} · {shift.requestedHeadcount} {role.code ?? role.name}
          </span>
        </span>
        <RefChip tone={chip.tone} className="font-semibold">
          {chip.label}
        </RefChip>
      </Link>
    </li>
  );
}

export function FacilityDetailsPanel({
  facility,
  typeName,
  locations,
  relationship,
  upcoming,
  requests,
  recordHref,
  shiftsHref,
  shiftHref,
  canViewShifts,
  canViewRelationship,
}: {
  facility: FacilityDetail;
  typeName: string;
  locations: FacilityLocation[];
  relationship: Relationship | null;
  upcoming: AgencyShiftSummary[];
  requests: AgencyShiftSummary[];
  recordHref: Route;
  shiftsHref: Route;
  shiftHref: (shiftId: string) => Route;
  canViewShifts: boolean;
  canViewRelationship: boolean;
}) {
  const id = `facility-${facility.id}`;
  const address = [
    facility.addressLine1,
    facility.addressLine2,
    [facility.locality, facility.region, facility.postalCode].filter(Boolean).join(", "),
  ].filter((line) => line && line.length > 0);
  const roles = [
    ...new Set(
      upcoming.map(
        (shift) => disciplineNameParts(shift.disciplineName).code ?? shift.disciplineName,
      ),
    ),
  ];
  const openRequests = requests.filter(
    (shift) => shift.status === "submitted" || shift.status === "open",
  );

  const information = (
    <Section id={`${id}-information`} title="Facility Information" divided={false}>
      <dl className="flex flex-col gap-2.5 text-[13.5px]">
        {[
          {
            key: "type",
            label: "Type",
            icon: <WorkspaceNavIcon name="facilities" strokeWidth={2.1} />,
            value: typeName,
          },
          ...(address.length > 0
            ? [
                {
                  key: "address",
                  label: "Address",
                  icon: <LocationPin className="size-[18px] text-chelth-teal-dark" />,
                  value: address.join("\n"),
                },
              ]
            : []),
          {
            key: "locations",
            label: "Locations",
            icon: <WorkspaceNavIcon name="operations" strokeWidth={2.1} />,
            value:
              locations.length > 0
                ? locations.map((location) => location.name).join(", ")
                : "No locations yet",
          },
          ...(roles.length > 0
            ? [
                {
                  key: "roles",
                  label: "Roles on upcoming shifts",
                  icon: <WorkspaceNavIcon name="workforce" strokeWidth={2.1} />,
                  value: roles.join(", "),
                },
              ]
            : []),
        ].map((row) => (
          <div key={row.key} className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-3">
            <dt className="row-span-2 pt-0.5 text-chelth-teal-dark [&>svg]:size-[18px]">
              {row.icon}
              <span className="sr-only">{row.label}</span>
            </dt>
            <span aria-hidden="true" className="text-[12.5px] leading-[18px] text-muted-foreground">
              {row.label}
            </span>
            <dd className={cn("leading-5 font-medium whitespace-pre-line", INK)}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );

  const stats = (
    <div className="grid grid-cols-3 gap-2 py-1">
      {[
        {
          key: "requests",
          value: openRequests.length,
          label: "Open Requests",
          tone: "text-danger-indicator",
          surface: "border-[rgba(229,72,77,0.18)] bg-[linear-gradient(145deg,#fff8f7,#fdeeed)]",
        },
        {
          key: "upcoming",
          value: upcoming.length,
          label: "Upcoming Shifts",
          tone: "text-info-indicator",
          surface: "border-[rgba(47,116,240,0.18)] bg-[linear-gradient(145deg,#f7fbff,#eaf3fe)]",
        },
        {
          key: "locations",
          value: locations.length,
          label: "Locations",
          tone: "text-chelth-teal-dark",
          surface: "border-[rgba(18,107,103,0.16)] bg-[linear-gradient(145deg,#f4fcf9,#e6f9f3)]",
        },
      ].map((stat) => (
        <div
          key={stat.key}
          className={cn(
            "flex flex-col rounded-[10px] border px-3 py-2.5 shadow-[0_4px_12px_rgba(13,47,66,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]",
            stat.surface,
          )}
        >
          <span
            className={cn(
              "font-display text-[24px] leading-7 font-bold tracking-[-0.01em] tabular-nums",
              stat.tone,
            )}
          >
            {stat.value}
          </span>
          <span className="mt-0.5 text-[12.5px] leading-4 font-semibold text-slate-600">
            {stat.label}
          </span>
        </div>
      ))}
    </div>
  );

  const requestList = (limit?: number) =>
    requests.length === 0 ? (
      <QuietEmpty
        icon={<WorkspaceNavIcon name="requests" strokeWidth={2} />}
        title="No upcoming requests"
        note="Staffing requests from this facility appear here."
      />
    ) : (
      <ul className="flex flex-col gap-1.5">
        {(limit ? requests.slice(0, limit) : requests).map((shift) => (
          <ShiftRow key={shift.id} shift={shift} href={shiftHref(shift.id)} />
        ))}
      </ul>
    );

  const tabs = [
    {
      id: "overview",
      label: "Overview",
      content: (
        <div className="flex flex-col">
          {information}
          {canViewShifts ? stats : null}
          {canViewShifts ? (
            <Section
              id={`${id}-recent-requests`}
              title="Recent Requests"
              action={
                requests.length > 2 ? (
                  <Link
                    href={shiftsHref}
                    className="text-[13.5px] font-semibold text-primary hover:underline"
                  >
                    View all
                  </Link>
                ) : undefined
              }
            >
              {requestList(2)}
            </Section>
          ) : null}
        </div>
      ),
    },
    ...(canViewShifts
      ? [
          {
            id: "requests",
            label: "Requests",
            content: (
              <Section
                id={`${id}-requests`}
                title={`Requests (${requests.length})`}
                divided={false}
              >
                {requestList()}
              </Section>
            ),
          },
          {
            id: "shifts",
            label: "Shifts",
            content: (
              <Section
                id={`${id}-shifts`}
                title={`Upcoming Shifts (${upcoming.length})`}
                divided={false}
              >
                {upcoming.length === 0 ? (
                  <QuietEmpty
                    icon={<WorkspaceNavIcon name="shifts" strokeWidth={2} />}
                    title="No upcoming shifts"
                    note="Shifts at this facility appear here."
                  />
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {upcoming.map((shift) => (
                      <ShiftRow key={shift.id} shift={shift} href={shiftHref(shift.id)} />
                    ))}
                  </ul>
                )}
              </Section>
            ),
          },
        ]
      : []),
    {
      id: "locations",
      label: "Locations",
      content: (
        <Section id={`${id}-locations`} title={`Locations (${locations.length})`} divided={false}>
          {locations.length === 0 ? (
            <QuietEmpty
              icon={<LocationPin className="size-[18px]" />}
              title="No locations yet"
              note="Add locations on the facility record."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-[rgba(18,107,103,0.10)]">
              {locations.map((location) => (
                <li key={location.id} className="flex min-h-[48px] items-center gap-3 py-1.5">
                  <IconTile>
                    <LocationPin className="size-[18px] text-chelth-teal-dark" />
                  </IconTile>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn("truncate text-[14.5px] leading-5 font-semibold", INK)}>
                      {location.name}
                    </span>
                    <span className="text-[12.5px] leading-[18px] text-slate-600">
                      {location.timezone}
                    </span>
                  </span>
                  <RefChip
                    tone={location.status === "active" ? "success" : "neutral"}
                    className="font-semibold"
                  >
                    {location.status === "active" ? "Active" : "Inactive"}
                  </RefChip>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ),
    },
  ];

  return (
    <div className="flex min-h-full flex-col text-[13.5px] leading-5">
      {/* Identity: facility tile (no photos in Chelth), name, type, locality, status. */}
      <div className="flex items-start gap-4 pt-1">
        <span
          aria-hidden="true"
          className="inline-flex size-[84px] shrink-0 items-center justify-center rounded-[14px] bg-[radial-gradient(circle_at_30%_25%,#f4fdfa_0%,#d3f2e8_45%,#a9e3d3_100%)] text-chelth-teal-dark shadow-[0_6px_16px_rgba(0,90,96,0.18),inset_0_1px_0_rgba(255,255,255,0.9)] ring-4 ring-white [&>svg]:size-10"
        >
          <WorkspaceNavIcon name="facilities" strokeWidth={1.9} duotone />
        </span>
        <div className="flex min-w-0 flex-1 flex-col pt-1">
          <p
            className={cn(
              "font-display text-[21px] leading-[27px] font-bold tracking-[-0.02em]",
              INK,
            )}
          >
            {facility.name}
          </p>
          <p className="truncate text-[14.5px] leading-[22px] font-medium text-slate-600">
            {typeName}
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[13.5px] text-slate-600">
              <LocationPin className="size-4 text-chelth-teal-dark" />
              <span className="truncate">{facility.locality ?? facility.timezone}</span>
            </span>
            <RefChip
              tone={FACILITY_TONE[facility.status]}
              className="h-7 px-3 text-[12.5px] font-semibold"
            >
              {FACILITY_STATUS_LABELS[facility.status]}
            </RefChip>
          </div>
        </div>
      </div>

      {/* Contact / relationship rows: real fields only. */}
      <dl className="mt-4 flex flex-col gap-1 text-[14px] text-slate-600">
        {[
          ...(canViewRelationship
            ? [
                {
                  key: "relationship",
                  label: "Relationship",
                  icon: <WorkspaceNavIcon name="compliance" strokeWidth={2.1} />,
                  value: relationship ? (
                    <span className="inline-flex items-center gap-2">
                      Relationship
                      <RefChip
                        tone={RELATIONSHIP_TONE[relationship.status]}
                        className="font-semibold"
                      >
                        {RELATIONSHIP_STATUS_LABELS[relationship.status]}
                      </RefChip>
                    </span>
                  ) : (
                    "No relationship yet"
                  ),
                },
              ]
            : []),
          ...(facility.phone
            ? [{ key: "phone", label: "Phone", icon: <PhoneIcon />, value: facility.phone }]
            : []),
          ...(facility.email
            ? [{ key: "email", label: "Email", icon: <MailIcon />, value: facility.email }]
            : []),
          {
            key: "linked",
            label: "Chelth organisation",
            icon: <WorkspaceNavIcon name="overview" strokeWidth={2.1} />,
            value: facility.linked
              ? "Linked to a CHELTH facility organisation"
              : "Not linked to a CHELTH organisation",
          },
        ].map((row) => (
          <div key={row.key} className="flex min-h-7 items-center gap-3">
            <dt className="flex w-5 justify-center text-chelth-teal-dark [&>svg]:size-[18px]">
              {row.icon}
              <span className="sr-only">{row.label}</span>
            </dt>
            <dd className="min-w-0 truncate">{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4">
        <DetailsTabs label={`${facility.name} details`} tabs={tabs} />
      </div>

      {/* Locked action region. */}
      <div className="mt-auto flex flex-col gap-2.5 pt-4">
        {canViewShifts ? (
          <Link
            href={shiftsHref}
            className="inline-flex h-12 items-center justify-center gap-2.5 rounded-[8px] bg-[linear-gradient(180deg,#00666c,#004f55)] text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_14px_-4px_rgba(0,58,64,0.45)] transition-[filter] hover:brightness-110"
          >
            <WorkspaceNavIcon name="shifts" strokeWidth={2.1} className="size-5" />
            View Shifts
          </Link>
        ) : null}
        <div className={cn("grid gap-2.5", canViewRelationship && "grid-cols-2")}>
          <Link
            href={recordHref}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-[rgba(0,90,96,0.35)] bg-white text-[14px] font-semibold text-chelth-navy shadow-[0_1px_2px_rgba(13,47,66,0.05)] hover:border-chelth-teal-dark hover:bg-[#f4fbf9]"
          >
            <WorkspaceNavIcon
              name="facilities"
              strokeWidth={2.1}
              className="size-[18px] text-chelth-teal-dark"
            />
            Facility Record
          </Link>
          {canViewRelationship ? (
            <Link
              href={`${recordHref}#relationship-heading` as Route}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-[rgba(0,90,96,0.35)] bg-white text-[14px] font-semibold text-chelth-navy shadow-[0_1px_2px_rgba(13,47,66,0.05)] hover:border-chelth-teal-dark hover:bg-[#f4fbf9]"
            >
              <WorkspaceNavIcon
                name="compliance"
                strokeWidth={2.1}
                className="size-[18px] text-chelth-teal-dark"
              />
              Relationship
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 3.5h3.2l1.6 4.1-2.1 1.3a11 11 0 0 0 7.4 7.4l1.3-2.1 4.1 1.6V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.1 1.5 1.5 0 0 1 5 3.5Z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}
