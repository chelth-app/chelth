import type { Metadata, Route } from "next";
import Link from "next/link";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import {
  InitialsAvatar,
  REF_CARD_FROSTED,
  RefChip,
  RefKpiCard,
} from "@/components/reference/locked-reference";
import { DataTableRegion } from "@/components/ui/data-table";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import type { StatusTone } from "@/components/ui/status-chip";
import { getReadiness, listWorkerDisciplines, type Readiness } from "@/features/compliance";
import { listDisciplines } from "@/features/credentials";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { type AgencyShiftSummary, listAgencyShifts, listShiftAssignments } from "@/features/shifts";
import { InviteWorkerForm, listWorkers } from "@/features/workforce";
import { CAPABILITIES } from "@/lib/authz";
import { READINESS_LABELS, type ReadinessStatus } from "@/lib/domain/credentials";
import {
  daysUntilDate,
  disciplineNameParts,
  formatShiftTimeRangeParts,
  hasEnded,
  hasStarted,
  startsLocalToday,
  todayIsoDate,
} from "@/lib/domain/shifts";
import { WORKER_STATUS_LABELS, WORKER_STATUSES } from "@/lib/domain/vocabulary";
import { cn } from "@/lib/utils/cn";

import { WorkerDetailsPanel } from "./_components/worker-details-panel";
import { WORKER_STATUS_TONE } from "./_components/worker-tones";

export const metadata: Metadata = { title: "Workforce" };

/** Locked Workforce reference: ten professionals per page. */
const PAGE_SIZE = 10;
/** Assignment lookahead for "Today" / "Current" / "Next shift" (existing per-shift loader). */
const LOOKAHEAD_DAYS = 30;

/** Credentials filter: the same two groups as the Needs Attention / Credential Ready cards. */
const CREDENTIAL_FILTERS = ["attention", "ready"] as const;

const READINESS_TONE: Record<ReadinessStatus, StatusTone> = {
  ready: "success",
  action_required: "warning",
  not_eligible: "danger",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

function shortDate(shift: AgencyShiftSummary): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: shift.timezone,
  }).format(new Date(shift.startAt));
}

/** Credentials cell: an expiring requirement is the most useful signal, else readiness. */
function credentialChip(readiness: Readiness): { tone: StatusTone; label: string } {
  const expiring = readiness.items
    .filter((item) => item.reason === "EXPIRING_SOON" && item.effectiveExpiryDate)
    .map((item) => daysUntilDate(item.effectiveExpiryDate ?? ""))
    .sort((a, b) => a - b)[0];
  if (readiness.status !== "not_eligible" && expiring !== undefined) {
    return {
      tone: "warning",
      label: `Expires in ${expiring} ${expiring === 1 ? "day" : "days"}`,
    };
  }
  return { tone: READINESS_TONE[readiness.status], label: READINESS_LABELS[readiness.status] };
}

export default async function WorkforcePage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/workforce">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.WORKER_VIEW);
  const { organisationId, organisation, can } = context;
  const canViewWorkers = can(CAPABILITIES.WORKER_VIEW) === "granted";
  const canCompliance = can(CAPABILITIES.COMPLIANCE_VIEW) === "granted";
  const canShifts = can(CAPABILITIES.SHIFT_VIEW) !== "not_held";
  const canAssignments = can(CAPABILITIES.ASSIGNMENT_VIEW) === "granted";
  const inviteState = can(CAPABILITIES.MEMBERSHIP_INVITE);

  const raw = await searchParams;
  const statusFilter = WORKER_STATUSES.find((status) => status === first(raw.status));
  const credentialFilter = CREDENTIAL_FILTERS.find((value) => value === first(raw.credentials));
  const roleFilter = first(raw.role);
  const search = (first(raw.q) ?? "").trim().slice(0, 80);
  const requestedPage = Number.parseInt(first(raw.page) ?? "1", 10);

  const today = todayIsoDate();
  const day = (offset: number) =>
    new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  const [workers, disciplines, lookahead] = await Promise.all([
    canViewWorkers ? listWorkers(organisationId) : Promise.resolve([]),
    listDisciplines(),
    canShifts && canAssignments
      ? listAgencyShifts(organisationId, { from: day(-1), to: day(LOOKAHEAD_DAYS) })
      : Promise.resolve([]),
  ]);

  // Readiness and disciplines: the worker record's own loaders and gates.
  const current = workers.filter((worker) => worker.status !== "terminated");
  const [readinessEntries, disciplineEntries, assignmentEntries] = await Promise.all([
    canCompliance
      ? Promise.all(
          current.map(async (worker) => [worker.id, await getReadiness(worker.id)] as const),
        )
      : Promise.resolve([]),
    Promise.all(
      workers.map(async (worker) => [worker.id, await listWorkerDisciplines(worker.id)] as const),
    ),
    Promise.all(
      lookahead
        .filter((shift) => shift.activeCount > 0 && !hasEnded(shift))
        .map(async (shift) => [shift, await listShiftAssignments(shift.id)] as const),
    ),
  ]);
  const readiness = new Map(readinessEntries);
  const disciplineName = new Map(disciplines.map((option) => [option.key, option.name]));
  const roleKeys = new Map(disciplineEntries);
  const roles = new Map(
    disciplineEntries.map(([workerId, keys]) => [
      workerId,
      keys.map((key) => disciplineName.get(key) ?? key),
    ]),
  );
  // Role options: the disciplines actually held in this workforce.
  const roleOptions = disciplines.filter((option) =>
    disciplineEntries.some(([, keys]) => keys.includes(option.key)),
  );
  const selectedRole = roleOptions.find((option) => option.key === roleFilter)?.key;
  const needsAttentionOf = (entry: Readiness) =>
    entry.status !== "ready" || entry.items.some((item) => item.reason === "EXPIRING_SOON");

  // Display filters + pagination over the already-loaded list (no new query).
  const needle = search.toLowerCase();
  const shown = workers.filter((worker) => {
    if (statusFilter && worker.status !== statusFilter) return false;
    if (selectedRole && !(roleKeys.get(worker.id) ?? []).includes(selectedRole)) return false;
    if (credentialFilter && canCompliance) {
      const entry = readiness.get(worker.id);
      if (!entry) return false;
      if (credentialFilter === "attention" ? !needsAttentionOf(entry) : needsAttentionOf(entry)) {
        return false;
      }
    }
    if (
      needle &&
      !(worker.displayName ?? "").toLowerCase().includes(needle) &&
      !(worker.workerReference ?? "").toLowerCase().includes(needle)
    ) {
      return false;
    }
    return true;
  });
  const hasFilters = Boolean(statusFilter || selectedRole || credentialFilter || search);
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const pageNumber = Math.min(
    Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1),
    pageCount,
  );
  const pageRows = shown.slice((pageNumber - 1) * PAGE_SIZE, pageNumber * PAGE_SIZE);

  // Real assignments (assigned or accepted) per worker, soonest first.
  const shiftsByWorker = new Map<string, AgencyShiftSummary[]>();
  for (const [shift, assignments] of assignmentEntries) {
    for (const assignment of assignments) {
      if (assignment.status !== "assigned" && assignment.status !== "accepted") continue;
      shiftsByWorker.set(assignment.workerId, [
        ...(shiftsByWorker.get(assignment.workerId) ?? []),
        shift,
      ]);
    }
  }
  for (const list of shiftsByWorker.values()) {
    list.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  }
  const currentShift = (workerId: string) =>
    (shiftsByWorker.get(workerId) ?? []).find((shift) => hasStarted(shift) && !hasEnded(shift)) ??
    null;
  const upcomingShifts = (workerId: string) =>
    (shiftsByWorker.get(workerId) ?? []).filter((shift) => !hasStarted(shift));

  const activeCount = workers.filter((worker) => worker.status === "active").length;
  const onAssignment = current.filter((worker) => currentShift(worker.id) !== null).length;
  const needsAttention = [...readiness.values()].filter(needsAttentionOf).length;
  const credentialReady = readiness.size - needsAttention;

  const base = `/app/organisations/${organisationId}/workforce` as const;
  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (statusFilter) query.set("status", statusFilter);
    if (selectedRole) query.set("role", selectedRole);
    if (credentialFilter) query.set("credentials", credentialFilter);
    if (search) query.set("q", search);
    if (target > 1) query.set("page", String(target));
    const text = query.toString();
    return (text ? `${base}?${text}` : base) as Route;
  };
  const firstShown = shown.length === 0 ? 0 : (pageNumber - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(pageNumber * PAGE_SIZE, shown.length);

  return (
    <div className="chelth-locked flex flex-col gap-5">
      <PageHeader
        variant="reference"
        title="Workforce"
        description={
          <p>Status, readiness, assignments and worker records for {organisation.name}.</p>
        }
        primaryAction={
          inviteState === "granted" ? (
            <a
              href="#invite-worker"
              className="inline-flex h-11 items-center gap-2.5 rounded-[7px] bg-chelth-teal-dark px-5 text-[15px] font-medium text-white shadow-[0_2px_6px_rgba(0,58,64,0.25)] hover:bg-chelth-teal sm:h-[47px] sm:min-w-[191px] sm:justify-center"
            >
              <span aria-hidden="true" className="text-xl leading-none font-light">
                +
              </span>
              Add Professional
            </a>
          ) : undefined
        }
      />

      {inviteState === "granted" ? (
        // The existing invite flow, revealed by "Add Professional" (CSS :target, same action).
        <section
          id="invite-worker"
          aria-labelledby="invite-worker-heading"
          className={cn(REF_CARD_FROSTED, "hidden scroll-mt-24 flex-col gap-3 p-4 target:flex")}
        >
          <div className="flex items-start justify-between gap-3">
            <h2
              id="invite-worker-heading"
              className="font-display text-[18px] leading-6 font-semibold text-chelth-navy"
            >
              Invite a healthcare worker
            </h2>
            <a
              href="#workers-heading"
              className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-primary underline underline-offset-4 hover:bg-surface-muted sm:min-h-9"
            >
              Close
            </a>
          </div>
          <InviteWorkerForm organisationId={organisationId} />
        </section>
      ) : inviteState === "step_up_required" ? (
        <StepUpNotice returnTo={`/app/organisations/${organisationId}/workforce`}>
          Inviting workers requires verification with your authenticator app.
        </StepUpNotice>
      ) : null}

      {/*
        Locked Workforce: with Professional Details open on wide screens the
        working area contracts beside the docked panel (CSS :has, no state).
      */}
      <div className="flex flex-col gap-5 min-[1536px]:has-[dialog[open]]:pr-[407px]">
        {workers.length > 0 ? (
          <section
            aria-label="Workers by status"
            className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-[9px]"
          >
            <RefKpiCard
              size="sm"
              label="Active"
              value={activeCount}
              supporting={`of ${workers.length} workers`}
              glyph="people"
              icon={<WorkspaceNavIcon name="workforce" strokeWidth={2.4} duotone />}
              tone="teal"
              href={`${base}?status=active` as Route}
              active={statusFilter === "active"}
            />
            <RefKpiCard
              size="sm"
              label="On Assignment"
              value={onAssignment}
              supporting="On a shift now"
              glyph="calendar"
              icon={<WorkspaceNavIcon name="shifts" strokeWidth={2.4} duotone />}
              tone="info"
            />
            {canCompliance ? (
              <>
                <RefKpiCard
                  size="sm"
                  label="Needs Attention"
                  value={needsAttention}
                  supporting="Expiring or not ready"
                  glyph="alert"
                  icon={<WorkspaceNavIcon name="attendance" strokeWidth={2.4} duotone />}
                  tone="warning"
                  href={`${base}?credentials=attention` as Route}
                  active={credentialFilter === "attention"}
                />
                <RefKpiCard
                  size="sm"
                  label="Credential Ready"
                  value={credentialReady}
                  supporting="All requirements met"
                  glyph="alert"
                  icon={<WorkspaceNavIcon name="compliance" strokeWidth={2.4} duotone />}
                  tone="teal"
                  href={`${base}?credentials=ready` as Route}
                  active={credentialFilter === "ready"}
                />
              </>
            ) : null}
          </section>
        ) : null}

        {workers.length > 0 ? (
          // Locked filter row: real display filters over the loaded workforce
          // (status, role, credential state, name / reference search).
          <form
            key={JSON.stringify([statusFilter, selectedRole, credentialFilter, search])}
            aria-label="Filter workers"
            method="get"
            className="flex flex-wrap items-center gap-[9px]"
          >
            <FilterSelect
              id="worker-status"
              name="status"
              label="Status"
              value={statusFilter ?? ""}
              className="xl:w-[194px]"
              icon={<WorkspaceNavIcon name="workforce" />}
            >
              <option value="">All statuses</option>
              {WORKER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {WORKER_STATUS_LABELS[status]}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              id="worker-role"
              name="role"
              label="Role"
              value={selectedRole ?? ""}
              className="xl:w-[148px]"
            >
              <option value="">All roles</option>
              {roleOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {disciplineNameParts(option.name).code ?? option.name}
                </option>
              ))}
            </FilterSelect>
            {canCompliance ? (
              <FilterSelect
                id="worker-credentials"
                name="credentials"
                label="Credentials"
                value={credentialFilter ?? ""}
                className="xl:w-[226px]"
              >
                <option value="">All credential status</option>
                <option value="attention">Needs attention</option>
                <option value="ready">Credential ready</option>
              </FilterSelect>
            ) : null}
            <span className="flex h-11 min-w-48 flex-1 items-center gap-2.5 rounded-md border border-chelth-border bg-white/90 px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring sm:h-[46px] xl:max-w-[260px]">
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
                className="size-[18px] shrink-0 text-chelth-navy"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <Label htmlFor="worker-search" className="sr-only">
                Search workers
              </Label>
              <input
                id="worker-search"
                name="q"
                type="search"
                defaultValue={search}
                placeholder="Search workforce…"
                className="min-w-0 flex-1 bg-transparent text-base text-chelth-navy outline-none placeholder:text-muted-foreground sm:text-[13.5px]"
              />
            </span>
            <button
              type="submit"
              className="inline-flex h-11 items-center rounded-md border border-chelth-border bg-white/90 px-4 text-[13.5px] font-medium text-chelth-navy hover:bg-surface-muted sm:h-[46px]"
            >
              Apply filters
            </button>
            {hasFilters ? (
              <Link
                href={base as Route}
                className="inline-flex min-h-11 items-center px-1 text-[13px] font-medium text-primary underline underline-offset-4"
              >
                Clear filters
              </Link>
            ) : null}
          </form>
        ) : null}

        <section aria-labelledby="workers-heading" className="flex flex-col gap-3">
          <h2 id="workers-heading" className="sr-only">
            Workers
          </h2>
          {workers.length === 0 ? (
            <EmptyState
              headingLevel={3}
              title="No workers yet."
              description="Invited workers appear here once they accept."
            />
          ) : shown.length === 0 ? (
            <EmptyState
              headingLevel={3}
              title={
                statusFilter && !selectedRole && !credentialFilter && !search
                  ? "No workers with this status."
                  : "No workers match these filters."
              }
              action={
                <Link
                  href={base}
                  className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4"
                >
                  Show all workers
                </Link>
              }
            />
          ) : (
            <div className={cn(REF_CARD_FROSTED, "overflow-hidden")}>
              <DataTableRegion
                aria-label="Workers table"
                className="rounded-none border-0 bg-transparent"
              >
                <table className="w-full min-w-[1040px] table-fixed border-separate border-spacing-0 text-left">
                  <colgroup>
                    <col className="w-[17%]" />
                    <col className="w-[12%]" />
                    <col className="w-[11%]" />
                    <col className="w-[11%]" />
                    <col className="w-[13%]" />
                    <col className="w-[13%]" />
                    <col className="w-[9.5%]" />
                    <col className="w-[9.5%]" />
                    <col className="w-[4%]" />
                  </colgroup>
                  <thead className="text-[12.5px] leading-4 font-semibold text-chelth-navy [&_th]:h-[47px] [&_th]:border-b [&_th]:border-chelth-border/55 [&_th]:bg-[color-mix(in_srgb,var(--chelth-mint-mist)_45%,#eef4f8)] [&_th]:px-3 [&_th]:font-semibold">
                    <tr>
                      <th scope="col" className="pl-4">
                        Name
                      </th>
                      <th scope="col">Role</th>
                      <th scope="col">Reference</th>
                      <th scope="col">Today</th>
                      <th scope="col">Current Assignment</th>
                      <th scope="col">Credentials</th>
                      <th scope="col">Next Shift</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="sr-only">Details</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-[13.5px] leading-[18px] text-slate-600 [&_td]:h-[60px] [&_td]:border-b [&_td]:border-chelth-border/45 [&_td]:px-3 [&_th]:border-b [&_th]:border-chelth-border/45 [&_tr:last-child>*]:border-b-0">
                    {pageRows.map((worker) => {
                      const name = worker.displayName ?? "Unnamed worker";
                      const href = `${base}/${worker.id}` as Route;
                      const workerRoles = roles.get(worker.id) ?? [];
                      const now = currentShift(worker.id);
                      const next = upcomingShifts(worker.id);
                      const scheduledToday =
                        now === null && next[0] !== undefined && startsLocalToday(next[0]);
                      const entry = readiness.get(worker.id);
                      const credential = entry ? credentialChip(entry) : null;
                      const role = workerRoles[0] ? disciplineNameParts(workerRoles[0]) : null;
                      return (
                        <tr
                          key={worker.id}
                          className="transition-colors hover:bg-surface-muted/50 has-[dialog[open]]:bg-chelth-mint-mist/70 [&:has(dialog[open])>*:first-child]:shadow-[inset_3px_0_0_var(--chelth-teal)]"
                        >
                          <th scope="row" className="h-[60px] pl-4 font-normal">
                            {/* Locked identity cell: 38 px avatar, name, discipline line. */}
                            <span className="flex items-center gap-3">
                              <InitialsAvatar name={worker.displayName} size={38} />
                              <span className="flex min-w-0 flex-col">
                                <Link
                                  href={href}
                                  className="truncate text-[14px] leading-5 font-semibold text-chelth-navy hover:text-primary hover:underline hover:underline-offset-4"
                                >
                                  {name}
                                </Link>
                                <span className="truncate text-[12px] leading-4 text-muted-foreground">
                                  {workerRoles[0]
                                    ? disciplineNameParts(workerRoles[0]).name
                                    : worker.startDate
                                      ? `Started ${worker.startDate}`
                                      : "Not started"}
                                </span>
                              </span>
                            </span>
                          </th>
                          <td>
                            <span className="line-clamp-2" title={workerRoles.join(", ")}>
                              {role ? (role.code ?? role.name) : "—"}
                              {workerRoles.length > 1 ? ` +${workerRoles.length - 1}` : ""}
                            </span>
                          </td>
                          <td className="truncate">{worker.workerReference ?? "—"}</td>
                          <td>
                            {now ? (
                              <RefChip tone="info" className="font-normal">
                                On shift
                              </RefChip>
                            ) : scheduledToday ? (
                              <RefChip tone="success" className="font-normal">
                                Scheduled
                              </RefChip>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            {now ? (
                              <span className="flex min-w-0 flex-col">
                                <span className="truncate">{now.facilityName}</span>
                                <span className="truncate text-muted-foreground">
                                  {now.locationName}
                                </span>
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            {credential ? (
                              <RefChip tone={credential.tone} className="font-normal">
                                {credential.label}
                              </RefChip>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            {next[0] ? (
                              <span className="flex flex-col">
                                <span className="text-chelth-navy">{shortDate(next[0])}</span>
                                <span className="truncate text-muted-foreground">
                                  {formatShiftTimeRangeParts(next[0]).range}
                                </span>
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            <RefChip
                              tone={WORKER_STATUS_TONE[worker.status]}
                              className="font-normal"
                            >
                              {WORKER_STATUS_LABELS[worker.status]}
                            </RefChip>
                          </td>
                          <td className="text-right">
                            <DetailDrawerTrigger
                              triggerLabel="⋮"
                              triggerClassName="justify-center px-2 text-xl font-bold text-chelth-navy no-underline sm:min-h-9"
                              triggerAccessibleLabel={`Details for ${name}`}
                              title="Professional Details"
                              width="profile"
                            >
                              <WorkerDetailsPanel
                                worker={worker}
                                roles={workerRoles}
                                current={now}
                                upcoming={next}
                                readiness={entry ?? null}
                                recordHref={href}
                                organisationName={organisation.name}
                                canViewCredentials={can(CAPABILITIES.CREDENTIAL_VIEW) === "granted"}
                              />
                            </DetailDrawerTrigger>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </DataTableRegion>
            </div>
          )}

          {shown.length > 0 ? (
            <nav
              aria-label="Workforce pages"
              className="flex flex-wrap items-center justify-between gap-3 pt-2"
            >
              <p className="text-[14px] text-slate-600">
                Showing {firstShown}–{lastShown} of {shown.length}{" "}
                {shown.length === 1 ? "professional" : "professionals"}
              </p>
              {pageCount > 1 ? (
                <ul className="flex items-center gap-2">
                  {Array.from({ length: pageCount }, (_, index) => index + 1).map((target) => (
                    <li key={target}>
                      <Link
                        href={pageHref(target)}
                        aria-current={target === pageNumber ? "page" : undefined}
                        className={cn(
                          "inline-flex size-11 items-center justify-center rounded-md border text-[14px] font-medium sm:size-9",
                          target === pageNumber
                            ? "border-chelth-teal-dark bg-chelth-teal-dark text-white"
                            : "border-chelth-border bg-white/90 text-chelth-navy hover:bg-surface-muted",
                        )}
                      >
                        {target}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </nav>
          ) : null}
        </section>
      </div>
    </div>
  );
}

/** Locked Workforce filter control: 46 px, hairline border, optional leading icon. */
function FilterSelect({
  id,
  name,
  label,
  value,
  className,
  icon,
  children,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  className?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex h-11 min-w-36 items-center gap-2 rounded-md border border-chelth-border bg-white/90 pl-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring sm:h-[46px]",
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="text-chelth-navy [&>svg]:size-[18px]">
          {icon}
        </span>
      ) : null}
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <select
        id={id}
        name={name}
        defaultValue={value}
        className="h-full min-w-0 flex-1 bg-transparent pr-3 text-base font-medium text-chelth-navy outline-none sm:text-[13.5px]"
      >
        {children}
      </select>
    </span>
  );
}
