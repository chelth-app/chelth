import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { RefChip } from "@/components/reference/locked-reference";
import { LocationPin } from "@/components/ui/location-pin";
import type { StatusTone } from "@/components/ui/status-chip";
import type { Readiness } from "@/features/compliance";
import type { AgencyShiftSummary } from "@/features/shifts";
import type { WorkerSummary } from "@/features/workforce";
import {
  COMPLIANCE_REASON_LABELS,
  type ComplianceReason,
  READINESS_LABELS,
} from "@/lib/domain/credentials";
import { formatShiftDate, formatShiftTimeRangeParts } from "@/lib/domain/shifts";
import { WORKER_STATUS_LABELS, type WorkerStatus } from "@/lib/domain/vocabulary";
import { cn } from "@/lib/utils/cn";

import { DetailsTabs } from "@/components/reference/details-tabs";
import { WORKER_STATUS_TONE } from "./worker-tones";

/** Readiness item tone: met is fine, expiring is a warning, the rest block. */
export function reasonTone(reason: ComplianceReason): StatusTone {
  if (reason === "MET") return "success";
  if (reason === "EXPIRING_SOON") return "warning";
  return "danger";
}

const STATUS_NOTE: Record<WorkerStatus, string> = {
  active: "Can be assigned to shifts",
  onboarding: "Completing onboarding",
  inactive: "Not currently working with the agency",
  suspended: "Cannot be assigned while suspended",
  terminated: "No longer with the agency",
};

/** Solid semantic fills (locked palette, scoped by .chelth-locked). */
const SOLID: Record<StatusTone, string> = {
  success: "bg-success-indicator",
  info: "bg-info-indicator",
  warning: "bg-warning-indicator",
  danger: "bg-danger-indicator",
  attention: "bg-attention-indicator",
  neutral: "bg-neutral-indicator",
};
const HALO: Record<StatusTone, string> = {
  success: "ring-success-soft",
  info: "ring-info-soft",
  warning: "ring-warning-soft",
  danger: "ring-danger-soft",
  attention: "ring-attention-soft",
  neutral: "ring-neutral-soft",
};

const INK = "text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]";

const validTo = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function initialsOf(name: string | null): string {
  return (
    (name ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "–"
  );
}

/** Section: 16 px / 800 ink heading, hairline separator, deliberate spacing. */
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

function ViewAll({ href }: { href: Route }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-[13.5px] font-semibold text-primary hover:underline"
    >
      View all
    </Link>
  );
}

/** Tinted icon tile for assignment / shift rows. */
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

function ShiftRow({ shift }: { shift: AgencyShiftSummary }) {
  const { range } = formatShiftTimeRangeParts(shift);
  return (
    <li className="grid grid-cols-[36px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-3 py-1">
      <IconTile>
        <WorkspaceNavIcon name="shifts" strokeWidth={2.1} />
      </IconTile>
      <span className="flex min-w-0 flex-col">
        <span className={cn("text-[14.5px] leading-5 font-semibold", INK)}>
          {formatShiftDate(shift)}
        </span>
        <span className="text-[13px] leading-[18px] text-slate-600">{range}</span>
      </span>
      <span className="flex min-w-0 flex-col text-right">
        <span className="truncate text-[13.5px] leading-5 font-medium text-chelth-navy">
          {shift.facilityName}
        </span>
        <span className="truncate text-[12.5px] leading-[18px] text-muted-foreground">
          {shift.locationName}
        </span>
      </span>
    </li>
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

function StatusGlyph({ tone }: { tone: StatusTone }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-white ring-4",
        SOLID[tone],
        HALO[tone],
      )}
    >
      <svg
        viewBox="0 0 16 16"
        className="size-[13px]"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {tone === "success" ? (
          <path d="M3.8 8.4 6.7 11.2 12.2 5.2" />
        ) : (
          <path d="M8 4.2v4.6M8 11.6v.2" />
        )}
      </svg>
    </span>
  );
}

function RequirementRows({ readiness, limit }: { readiness: Readiness; limit?: number }) {
  const items = limit ? readiness.items.slice(0, limit) : readiness.items;
  if (items.length === 0) {
    return (
      <QuietEmpty
        icon={<WorkspaceNavIcon name="compliance" strokeWidth={2} />}
        title="No requirements apply"
        note="Requirements set by the agency appear here."
      />
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-[rgba(18,107,103,0.10)]">
      {items.map((item, index) => {
        const tone = reasonTone(item.reason);
        return (
          <li
            key={`${item.requirementId ?? item.credentialTypeKey ?? "item"}-${index}`}
            className="flex min-h-[48px] items-center gap-3 py-1.5"
          >
            <StatusGlyph tone={tone} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cn("line-clamp-2 text-[14.5px] leading-5 font-semibold", INK)}>
                {item.credentialTypeName ?? "Requirement"}
              </span>
              <span className="text-[12.5px] leading-[18px] text-slate-600">
                {item.effectiveExpiryDate
                  ? `Valid to ${validTo.format(new Date(`${item.effectiveExpiryDate}T00:00:00Z`))}`
                  : item.scope === "facility"
                    ? "Facility requirement"
                    : "Agency requirement"}
              </span>
            </span>
            <RefChip tone={tone} className="h-7 px-3 text-[12px] font-semibold">
              {COMPLIANCE_REASON_LABELS[item.reason]}
            </RefChip>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Professional Details — the locked Workforce drawer, populated only with
 * data Chelth holds and the worker record already shows: worker status,
 * reference and dates, disciplines, real assignments and live readiness
 * items (the record's own loaders and capability gates). Contact details,
 * availability, photos, messaging and an activity feed do not exist in the
 * product and are not shown.
 */
export function WorkerDetailsPanel({
  worker,
  roles,
  organisationName,
  current,
  upcoming,
  readiness,
  recordHref,
  canViewCredentials,
}: {
  worker: WorkerSummary;
  roles: string[];
  organisationName: string;
  current: AgencyShiftSummary | null;
  upcoming: AgencyShiftSummary[];
  readiness: Readiness | null;
  recordHref: Route;
  /** CREDENTIAL_VIEW: the record renders its Credentials section. */
  canViewCredentials: boolean;
}) {
  const name = worker.displayName ?? "Unnamed worker";
  const id = `worker-${worker.id}`;
  const tone = WORKER_STATUS_TONE[worker.status];

  const statusSection = (
    <Section id={`${id}-status`} title="Status" divided={false}>
      <div className="flex items-start gap-3.5 pl-0.5">
        <span
          aria-hidden="true"
          className={cn("mt-[5px] size-3 shrink-0 rounded-full ring-4", SOLID[tone], HALO[tone])}
        />
        <span className="flex flex-col">
          <span className={cn("text-[15px] leading-5 font-semibold", INK)}>
            {WORKER_STATUS_LABELS[worker.status]}
          </span>
          <span className="text-[13px] leading-[19px] text-slate-600">
            {STATUS_NOTE[worker.status]}
            {readiness ? ` · ${READINESS_LABELS[readiness.status]}` : ""}
          </span>
        </span>
      </div>
    </Section>
  );
  const currentSection = (
    <Section id={`${id}-current`} title="Current Assignment">
      {current ? (
        <ul className="flex flex-col">
          <ShiftRow shift={current} />
        </ul>
      ) : (
        <QuietEmpty
          icon={<WorkspaceNavIcon name="shifts" strokeWidth={2} />}
          title="No active assignment"
          note="Shows a shift while it is in progress."
        />
      )}
    </Section>
  );
  const upcomingSection = (limit?: number) => (
    <Section
      id={`${id}-upcoming${limit ? "" : "-all"}`}
      title={`Upcoming Shifts (${upcoming.length})`}
      action={limit && upcoming.length > limit ? <ViewAll href={recordHref} /> : undefined}
    >
      {upcoming.length === 0 ? (
        <QuietEmpty
          icon={<WorkspaceNavIcon name="shifts" strokeWidth={2} />}
          title="No upcoming shifts"
          note="Assigned shifts appear here."
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {(limit ? upcoming.slice(0, limit) : upcoming).map((shift) => (
            <ShiftRow key={shift.id} shift={shift} />
          ))}
        </ul>
      )}
    </Section>
  );
  const credentialsSection = readiness ? (
    <Section
      id={`${id}-credentials`}
      title="Credentials"
      action={<ViewAll href={`${recordHref}#readiness-heading` as Route} />}
    >
      <RequirementRows readiness={readiness} limit={4} />
    </Section>
  ) : null;

  const tabs = [
    {
      id: "overview",
      label: "Overview",
      content: (
        <div className="flex flex-col">
          {statusSection}
          {currentSection}
          {upcomingSection(2)}
          {credentialsSection}
        </div>
      ),
    },
    ...(readiness
      ? [
          {
            id: "credentials",
            label: "Credentials",
            content: (
              <Section id={`${id}-credentials-all`} title="Requirements" divided={false}>
                <RequirementRows readiness={readiness} />
              </Section>
            ),
          },
        ]
      : []),
    {
      id: "assignments",
      label: "Assignments",
      content: (
        <div className="flex flex-col">
          {currentSection}
          {upcomingSection()}
        </div>
      ),
    },
  ];

  return (
    <div className="flex min-h-full flex-col text-[13.5px] leading-5">
      {/* Identity header: luminous mint initials tile, prominent name, quiet metadata. */}
      <div className="flex items-start gap-4 pt-1">
        <span
          aria-hidden="true"
          className="inline-flex size-[90px] shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_30%_25%,#f4fdfa_0%,#d3f2e8_45%,#a9e3d3_100%)] font-display text-[30px] font-bold tracking-[-0.02em] text-chelth-teal-dark shadow-[0_6px_16px_rgba(0,90,96,0.18),inset_0_1px_0_rgba(255,255,255,0.9)] ring-4 ring-white"
        >
          {initialsOf(worker.displayName)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col pt-2.5">
          <div className="flex items-start justify-between gap-2">
            <p
              className={cn(
                "font-display text-[23px] leading-[30px] font-bold tracking-[-0.02em]",
                INK,
              )}
            >
              {name}
            </p>
            <RefChip tone={tone} className="mt-0.5 h-7 px-3 text-[12.5px] font-semibold">
              {WORKER_STATUS_LABELS[worker.status]}
            </RefChip>
          </div>
          <p className="truncate text-[15px] leading-[22px] font-medium text-slate-600">
            {roles.length > 0 ? roles.join(", ") : "No discipline recorded"}
          </p>
          <p className="truncate text-[13.5px] leading-5 text-muted-foreground">
            {organisationName}
          </p>
        </div>
      </div>

      {/* Metadata rows (the reference contact slot): real fields only. */}
      <dl className="mt-4 flex flex-col gap-1 text-[14px] text-slate-600">
        {[
          {
            key: "reference",
            label: "Worker reference",
            icon: <WorkspaceNavIcon name="timesheets" strokeWidth={2.1} />,
            value: worker.workerReference ? `Ref ${worker.workerReference}` : "No worker reference",
          },
          {
            key: "dates",
            label: "Start date",
            icon: <WorkspaceNavIcon name="shifts" strokeWidth={2.1} />,
            value: `${worker.startDate ? `Started ${worker.startDate}` : "Not started"}${
              worker.endDate ? ` · ends ${worker.endDate}` : ""
            }`,
          },
          {
            key: "agency",
            label: "Agency",
            icon: <LocationPin className="size-[18px] text-chelth-teal-dark" />,
            value: organisationName,
          },
        ].map((row) => (
          <div key={row.key} className="flex h-7 items-center gap-3">
            <dt className="flex w-5 justify-center text-chelth-teal-dark [&>svg]:size-[18px]">
              {row.icon}
              <span className="sr-only">{row.label}</span>
            </dt>
            <dd className="truncate">{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4">
        <DetailsTabs label={`${name} details`} tabs={tabs} />
      </div>

      {/* Action region at the foot: strong primary, outlined secondaries. */}
      <div className="mt-auto flex flex-col gap-2.5 pt-4">
        <Link
          href={recordHref}
          className="inline-flex h-12 items-center justify-center gap-2.5 rounded-[8px] bg-[linear-gradient(180deg,#00666c,#004f55)] text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_14px_-4px_rgba(0,58,64,0.45)] transition-[filter] hover:brightness-110"
        >
          <WorkspaceNavIcon name="workforce" strokeWidth={2.1} className="size-5" />
          Open Worker Record
        </Link>
        {readiness || canViewCredentials ? (
          <div className={cn("grid gap-2.5", readiness && canViewCredentials && "grid-cols-2")}>
            {readiness ? (
              <Link
                href={`${recordHref}#readiness-heading` as Route}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-[rgba(0,90,96,0.35)] bg-white text-[14px] font-semibold text-chelth-navy shadow-[0_1px_2px_rgba(13,47,66,0.05)] hover:border-chelth-teal-dark hover:bg-[#f4fbf9]"
              >
                <WorkspaceNavIcon
                  name="compliance"
                  strokeWidth={2.1}
                  className="size-[18px] text-chelth-teal-dark"
                />
                Readiness
              </Link>
            ) : null}
            {canViewCredentials ? (
              <Link
                href={`${recordHref}#credentials-heading` as Route}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-[rgba(0,90,96,0.35)] bg-white text-[14px] font-semibold text-chelth-navy shadow-[0_1px_2px_rgba(13,47,66,0.05)] hover:border-chelth-teal-dark hover:bg-[#f4fbf9]"
              >
                <WorkspaceNavIcon
                  name="timesheets"
                  strokeWidth={2.1}
                  className="size-[18px] text-chelth-teal-dark"
                />
                View Credentials
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
