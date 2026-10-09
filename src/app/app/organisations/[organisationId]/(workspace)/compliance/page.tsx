import type { Metadata, Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import {
  InitialsAvatar,
  REF_TABLE,
  REF_TEXT,
  RefChip,
  RefKpiCard,
  RefPanel,
} from "@/components/reference/locked-reference";
import { DataTableRegion } from "@/components/ui/data-table";
import { DetailDrawerTrigger } from "@/components/ui/detail-drawer";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import {
  type ComplianceItem,
  getReadiness,
  listRequirements,
  listWorkerDisciplines,
  RequirementForm,
  RequirementsTable,
} from "@/features/compliance";
import {
  type AgencyWorkerCredential,
  listAgencyWorkerCredentials,
  listCredentialTypes,
  listDisciplines,
  listJurisdictions,
} from "@/features/credentials";
import { listFacilities } from "@/features/facilities";
import {
  loadOrganisationPage,
  requireCapabilityOrNotFound,
  StepUpNotice,
} from "@/features/organisations";
import { listWorkers } from "@/features/workforce";
import { CAPABILITIES } from "@/lib/authz";
import {
  COMPLIANCE_REASON_LABELS,
  formatCalendarDate,
  VERIFICATION_LABELS,
} from "@/lib/domain/credentials";
import { daysUntilDate } from "@/lib/domain/shifts";
import { cn } from "@/lib/utils/cn";

import {
  complianceTone,
  REGISTER_GROUP_LABELS,
  REGISTER_GROUPS,
  type RegisterGroup,
  registerGroup,
  VERIFICATION_TONE,
} from "./_components/compliance-tones";
import { CredentialDetailsPanel, expiryNote } from "./_components/credential-details-panel";

export const metadata: Metadata = { title: "Compliance" };

const PAGE_SIZE = 10;
/** Expiration filter windows (days from today, UTC calendar dates). */
const EXPIRATION_FILTERS = {
  "30": "Within 30 days",
  "90": "Within 90 days",
  expired: "Expired",
} as const;
type ExpirationFilter = keyof typeof EXPIRATION_FILTERS;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

type RegisterRow = {
  key: string;
  workerId: string;
  workerName: string | null;
  roles: string[];
  item: ComplianceItem;
  group: RegisterGroup;
  scopeLabel: string;
  credential: AgencyWorkerCredential | null;
  daysLeft: number | null;
};

/**
 * Agency Compliance (locked Credentials reference). The register is the
 * readiness engine's own result for each current worker and requirement —
 * the same loaders and gates as Workforce and the worker record. Nothing here
 * computes eligibility; filters only narrow the loaded results. Baseline
 * requirement management follows, unchanged.
 */
export default async function CompliancePage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/compliance">) {
  const context = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.CREDENTIAL_REQUIREMENTS_VIEW);
  const { organisationId, organisation, can } = context;
  const manage = can(CAPABILITIES.CREDENTIAL_REQUIREMENTS_MANAGE);
  const canRegister =
    can(CAPABILITIES.COMPLIANCE_VIEW) === "granted" && can(CAPABILITIES.WORKER_VIEW) === "granted";
  const canCredentials = can(CAPABILITIES.CREDENTIAL_VIEW) === "granted";
  const canFacilities = can(CAPABILITIES.FACILITY_VIEW) === "granted";

  const raw = await searchParams;
  const [requirements, credentialTypes, disciplines, jurisdictions, workers, facilityList] =
    await Promise.all([
      listRequirements(organisationId),
      listCredentialTypes(),
      listDisciplines(),
      listJurisdictions(),
      canRegister ? listWorkers(organisationId) : Promise.resolve([]),
      canRegister && canFacilities ? listFacilities(organisationId) : Promise.resolve([]),
    ]);
  const facilities = facilityList.filter((facility) => facility.status !== "archived");
  const facility = facilities.find((option) => option.id === first(raw.facility));

  // The engine's own evaluation per current worker (baseline, or baseline + one facility).
  const current = workers.filter((worker) => worker.status !== "terminated");
  const evaluated = canRegister
    ? await Promise.all(
        current.map(async (worker) => {
          const [readiness, roles, credentials] = await Promise.all([
            getReadiness(worker.id, facility?.id),
            listWorkerDisciplines(worker.id),
            canCredentials ? listAgencyWorkerCredentials(worker.id) : Promise.resolve([]),
          ]);
          return { worker, readiness, roles, credentials };
        }),
      )
    : [];
  const disciplineName = new Map(disciplines.map((option) => [option.key, option.name]));
  const coverageOf = new Map(evaluated.map((entry) => [entry.worker.id, entry.readiness.items]));
  const register: RegisterRow[] = evaluated.flatMap(({ worker, readiness, roles, credentials }) =>
    readiness.items.map((item, index) => {
      const matches = credentials.filter(
        (credential) => item.credentialTypeName && credential.typeName === item.credentialTypeName,
      );
      const credential =
        matches.find((match) => match.effectiveExpiryDate === item.effectiveExpiryDate) ??
        matches[0] ??
        null;
      return {
        key: `${worker.id}-${item.requirementId ?? item.credentialTypeKey ?? "worker"}-${index}`,
        workerId: worker.id,
        workerName: worker.displayName,
        roles: roles.map((key) => disciplineName.get(key) ?? key),
        item,
        group: registerGroup(item.reason),
        scopeLabel:
          item.scope === "facility"
            ? (facility?.name ?? "Facility requirement")
            : item.scope === "agency"
              ? "Agency baseline"
              : "Worker",
        credential,
        daysLeft: item.effectiveExpiryDate ? daysUntilDate(item.effectiveExpiryDate) : null,
      };
    }),
  );

  // Display filters over the loaded register (no new query reaches the database).
  const workerFilter = current.find((worker) => worker.id === first(raw.professional))?.id;
  const typeNames = [
    ...new Set(
      register.flatMap((row) => (row.item.credentialTypeName ? [row.item.credentialTypeName] : [])),
    ),
  ].sort();
  const typeFilter = typeNames.find((name) => name === first(raw.type));
  const statusFilter = REGISTER_GROUPS.find((group) => group === first(raw.status));
  const expirationFilter = (Object.keys(EXPIRATION_FILTERS) as ExpirationFilter[]).find(
    (key) => key === first(raw.expiration),
  );
  const search = (first(raw.q) ?? "").trim().slice(0, 80);
  const needle = search.toLowerCase();
  const shown = register.filter((row) => {
    if (workerFilter && row.workerId !== workerFilter) return false;
    if (typeFilter && row.item.credentialTypeName !== typeFilter) return false;
    if (statusFilter && row.group !== statusFilter) return false;
    if (expirationFilter) {
      if (row.daysLeft === null) return false;
      if (expirationFilter === "expired" ? row.daysLeft >= 0 : row.daysLeft < 0) return false;
      if (expirationFilter !== "expired" && row.daysLeft > Number(expirationFilter)) return false;
    }
    if (
      needle &&
      !(row.workerName ?? "").toLowerCase().includes(needle) &&
      !(row.item.credentialTypeName ?? "").toLowerCase().includes(needle)
    ) {
      return false;
    }
    return true;
  });

  const requestedPage = Number.parseInt(first(raw.page) ?? "1", 10);
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const pageNumber = Math.min(
    Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1),
    pageCount,
  );
  const pageRows = shown.slice((pageNumber - 1) * PAGE_SIZE, pageNumber * PAGE_SIZE);
  const firstShown = shown.length === 0 ? 0 : (pageNumber - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(pageNumber * PAGE_SIZE, shown.length);

  const base = `/app/organisations/${organisationId}/compliance` as const;
  const query = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const values: Record<string, string | undefined> = {
      professional: workerFilter,
      type: typeFilter,
      status: statusFilter,
      facility: facility?.id,
      expiration: expirationFilter,
      q: search || undefined,
      ...overrides,
    };
    for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
    const text = params.toString();
    return (text ? `${base}?${text}` : base) as Route;
  };
  const count = (group: RegisterGroup) => register.filter((row) => row.group === group).length;
  const narrowed = Boolean(workerFilter || typeFilter || expirationFilter || search);
  const quick = (group: RegisterGroup) => ({
    href: query({ status: group, page: undefined }),
    active: statusFilter === group && !narrowed,
  });
  const hasFilters = Boolean(narrowed || statusFilter || facility);
  const workerHref = (workerId: string) =>
    `/app/organisations/${organisationId}/workforce/${workerId}` as Route;
  const credentialHref = (row: RegisterRow) =>
    row.credential && canCredentials
      ? (`/app/organisations/${organisationId}/workforce/${row.workerId}/credentials/${row.credential.credentialId}` as Route)
      : null;
  const blocked = count("blocked");

  return (
    <div className="chelth-locked flex flex-col gap-[13px]">
      <PageHeader
        variant="reference"
        className="xl:mb-1"
        title="Compliance"
        description={
          <p>Monitor workforce credentials, expirations, and readiness across your organization.</p>
        }
        primaryAction={
          manage === "granted" ? (
            <a
              href="#add-baseline-heading"
              className="inline-flex h-12 items-center justify-center gap-2.5 rounded-[8px] bg-[linear-gradient(180deg,#00666c,#004f55)] px-5 text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_14px_-4px_rgba(0,58,64,0.45)] transition-[filter] hover:brightness-110"
            >
              <span aria-hidden="true" className="text-[20px] leading-none font-normal">
                +
              </span>
              Add requirement
            </a>
          ) : undefined
        }
      />

      {manage === "step_up_required" ? (
        <StepUpNotice returnTo={base}>
          Changing requirements requires verification with your authenticator app.
        </StepUpNotice>
      ) : null}

      {canRegister ? (
        // Locked: with Credential Details open on wide screens the work area contracts beside it.
        <div className="flex flex-col gap-[13px] min-[1536px]:has-[dialog[open]]:pr-[407px]">
          <section
            aria-label="Credential readiness summary"
            className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-[9px]"
          >
            <RefKpiCard
              size="sm"
              label="Up to Date"
              value={count("up_to_date")}
              supporting="Requirement met"
              glyph="document"
              icon={<WorkspaceNavIcon name="compliance" strokeWidth={2.4} duotone />}
              tone="teal"
              {...quick("up_to_date")}
            />
            <RefKpiCard
              size="sm"
              label="Expiring Soon"
              value={count("expiring")}
              supporting="Within the warning window"
              glyph="calendar"
              icon={<WorkspaceNavIcon name="shifts" strokeWidth={2.4} duotone />}
              tone="warning"
              {...quick("expiring")}
            />
            <RefKpiCard
              size="sm"
              label="Needs Review"
              value={count("review")}
              supporting="Verification or security scan"
              glyph="alert"
              icon={<WorkspaceNavIcon name="requests" strokeWidth={2.4} duotone />}
              tone="info"
              {...quick("review")}
            />
            <RefKpiCard
              size="sm"
              label="Missing"
              value={count("missing")}
              supporting={
                blocked > 0
                  ? `Not held or not submitted · ${blocked} other ${blocked === 1 ? "issue" : "issues"}`
                  : "Not held or not submitted"
              }
              glyph="document"
              icon={<WorkspaceNavIcon name="timesheets" strokeWidth={2.4} duotone />}
              tone="danger"
              {...quick("missing")}
            />
          </section>

          {/* Locked filter row: real display filters over the loaded register; Facility
              re-evaluates readiness with that facility's requirements (engine-side). */}
          <form
            key={JSON.stringify([
              workerFilter,
              typeFilter,
              statusFilter,
              facility?.id,
              expirationFilter,
              search,
            ])}
            aria-label="Filter credentials"
            method="get"
            className="flex flex-wrap items-center gap-[9px]"
          >
            <FilterSelect
              id="compliance-professional"
              name="professional"
              label="Professional"
              value={workerFilter ?? ""}
              className="xl:w-[176px]"
              icon={<WorkspaceNavIcon name="workforce" strokeWidth={2.1} />}
            >
              <option value="">All professionals</option>
              {current.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.displayName ?? "Worker"}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              id="compliance-type"
              name="type"
              label="Type"
              value={typeFilter ?? ""}
              className="xl:w-[184px]"
            >
              <option value="">All credential types</option>
              {typeNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              id="compliance-status"
              name="status"
              label="Status"
              value={statusFilter ?? ""}
              className="xl:w-[150px]"
            >
              <option value="">All statuses</option>
              {REGISTER_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {REGISTER_GROUP_LABELS[group]}
                </option>
              ))}
            </FilterSelect>
            {canFacilities ? (
              <FilterSelect
                id="compliance-facility"
                name="facility"
                label="Facility"
                value={facility?.id ?? ""}
                className="xl:w-[176px]"
              >
                <option value="">Agency baseline</option>
                {facilities.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </FilterSelect>
            ) : null}
            <FilterSelect
              id="compliance-expiration"
              name="expiration"
              label="Expiration"
              value={expirationFilter ?? ""}
              className="xl:w-[160px]"
            >
              <option value="">Expiration: All</option>
              {(Object.keys(EXPIRATION_FILTERS) as ExpirationFilter[]).map((key) => (
                <option key={key} value={key}>
                  {EXPIRATION_FILTERS[key]}
                </option>
              ))}
            </FilterSelect>
            <span className="flex h-[46px] min-w-44 flex-1 items-center gap-2.5 rounded-md border border-chelth-border bg-white/90 px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring xl:max-w-[240px]">
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
              <Label htmlFor="compliance-search" className="sr-only">
                Search credentials
              </Label>
              <input
                id="compliance-search"
                name="q"
                type="search"
                defaultValue={search}
                placeholder="Search credentials…"
                className="h-full min-w-0 flex-1 bg-transparent text-base text-chelth-navy outline-none placeholder:text-muted-foreground sm:text-[13.5px]"
              />
            </span>
            <button
              type="submit"
              className="inline-flex h-11 items-center rounded-md border border-chelth-border bg-white/90 px-4 text-[13.5px] font-medium text-chelth-navy hover:bg-surface-muted sm:h-[46px]"
            >
              Show
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

          <RefPanel
            title="Credential Register"
            titleId="register-heading"
            action={
              <span className="text-[13.5px] text-muted-foreground">
                {facility ? `Baseline + ${facility.name}` : "Agency baseline"}
              </span>
            }
          >
            {current.length === 0 ? (
              <ComplianceEmpty
                title="No workers yet."
                note="Readiness appears here once workers join your agency."
              />
            ) : register.length === 0 ? (
              <ComplianceEmpty
                title="No requirements apply yet."
                note="Add a baseline requirement below; readiness is calculated from it."
              />
            ) : shown.length === 0 ? (
              <ComplianceEmpty
                title={
                  statusFilter === "missing" && !narrowed
                    ? "No missing credentials."
                    : statusFilter === "expiring" && !narrowed
                      ? "No expiring credentials."
                      : statusFilter === "review" && !narrowed
                        ? "No credentials waiting for review."
                        : "No credentials match these filters."
                }
                note="Change the filters to see other results."
              />
            ) : (
              <>
                <DataTableRegion
                  aria-label="Credential register table"
                  className="mt-[9px] rounded-none border-0 bg-transparent"
                >
                  <table className={cn(REF_TABLE, "min-w-[960px] table-fixed")}>
                    <colgroup>
                      <col className="w-[17%]" />
                      <col className="w-[12%]" />
                      <col className="w-[17%]" />
                      <col className="w-[16%]" />
                      <col className="w-[11%]" />
                      <col className="w-[13%]" />
                      <col className="w-[10%]" />
                      <col className="w-[4%]" />
                    </colgroup>
                    <thead className={REF_TEXT.tableHead}>
                      <tr>
                        <th scope="col">Professional</th>
                        <th scope="col">Role</th>
                        <th scope="col">Credential</th>
                        <th scope="col">Status</th>
                        <th scope="col">Verification</th>
                        <th scope="col">Expires</th>
                        <th scope="col">Scope</th>
                        <th scope="col">
                          <span className="sr-only">Details</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className={REF_TEXT.tableBody}>
                      {pageRows.map((row) => {
                        const worker = row.workerName ?? "Worker";
                        const title =
                          row.item.credentialTypeName ?? COMPLIANCE_REASON_LABELS[row.item.reason];
                        return (
                          <tr
                            key={row.key}
                            className="h-[48px] transition-colors hover:bg-surface-muted/50 has-[dialog[open]]:bg-chelth-mint-mist/70 [&:has(dialog[open])>*:first-child]:shadow-[inset_3px_0_0_var(--chelth-teal)]"
                          >
                            <td>
                              <span className="flex items-center gap-2.5">
                                <InitialsAvatar name={row.workerName} />
                                <Link
                                  href={workerHref(row.workerId)}
                                  className="truncate font-medium text-chelth-navy hover:text-primary hover:underline hover:underline-offset-4"
                                >
                                  {worker}
                                </Link>
                              </span>
                            </td>
                            <td className="truncate">
                              {row.roles.length > 0 ? row.roles.join(", ") : "—"}
                            </td>
                            <td>
                              <span className="line-clamp-2">{title}</span>
                            </td>
                            <td className="pr-3!">
                              <RefChip
                                tone={complianceTone(row.item.reason)}
                                className="font-normal"
                              >
                                {COMPLIANCE_REASON_LABELS[row.item.reason]}
                              </RefChip>
                            </td>
                            <td>
                              {row.credential?.agencyVerification ? (
                                <RefChip
                                  tone={VERIFICATION_TONE[row.credential.agencyVerification]}
                                  className="font-normal"
                                >
                                  {VERIFICATION_LABELS[row.credential.agencyVerification]}
                                </RefChip>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td>
                              {row.item.effectiveExpiryDate && row.daysLeft !== null ? (
                                <span className="flex flex-col">
                                  <span className="whitespace-nowrap">
                                    {formatCalendarDate(row.item.effectiveExpiryDate)}
                                  </span>
                                  <span
                                    className={cn(
                                      "text-[11px] leading-4",
                                      row.daysLeft < 0
                                        ? "text-danger-soft-foreground"
                                        : row.item.reason === "EXPIRING_SOON"
                                          ? "text-warning-soft-foreground"
                                          : "text-muted-foreground",
                                    )}
                                  >
                                    {expiryNote(row.daysLeft)}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="truncate">{row.scopeLabel}</td>
                            <td className="text-right">
                              <DetailDrawerTrigger
                                triggerLabel="⋮"
                                triggerClassName="justify-center px-2 text-xl font-bold text-chelth-navy no-underline sm:min-h-9"
                                triggerAccessibleLabel={`Details for ${worker}, ${title}`}
                                title="Credential Details"
                                width="profile"
                              >
                                <CredentialDetailsPanel
                                  id={`credential-${row.key}`}
                                  workerName={row.workerName}
                                  roles={row.roles}
                                  item={row.item}
                                  scopeLabel={row.scopeLabel}
                                  credential={row.credential}
                                  daysLeft={row.daysLeft}
                                  coverage={coverageOf.get(row.workerId) ?? []}
                                  credentialHref={credentialHref(row)}
                                  workerHref={workerHref(row.workerId)}
                                />
                              </DetailDrawerTrigger>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </DataTableRegion>
                <nav
                  aria-label="Credential register pages"
                  className="flex flex-wrap items-center justify-between gap-3 px-[5px] pt-3"
                >
                  <p className="text-[14px] text-slate-600">
                    Showing {firstShown}–{lastShown} of {shown.length}{" "}
                    {shown.length === 1 ? "result" : "results"}
                  </p>
                  {pageCount > 1 ? (
                    <ul className="flex flex-wrap items-center gap-2">
                      {Array.from({ length: pageCount }, (_, index) => index + 1).map((target) => (
                        <li key={target}>
                          <Link
                            href={query({ page: String(target) })}
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
              </>
            )}
          </RefPanel>
        </div>
      ) : null}

      <Panel titleId="baseline-heading" title={<>Agency baseline requirements</>}>
        <p className="mb-1 max-w-[68ch] text-[13.5px] leading-[21px] text-slate-600">
          Baseline requirements apply to every worker at {organisation.name} (or to one discipline).
          Client facilities can add their own on the facility page. Readiness is always calculated
          from these requirements and the worker&apos;s evidence — it is never set by hand.
        </p>
        <RequirementsTable
          organisationId={organisationId}
          requirements={requirements}
          typeNames={new Map(credentialTypes.map((type) => [type.key, type.name]))}
          disciplineNames={
            new Map(disciplines.map((discipline) => [discipline.key, discipline.name]))
          }
          canManage={manage === "granted"}
          label="Agency baseline requirements"
        />
      </Panel>

      {manage === "granted" ? (
        <Panel titleId="add-baseline-heading" title={<>Add a baseline requirement</>}>
          <RequirementForm
            organisationId={organisationId}
            credentialTypes={credentialTypes}
            disciplines={disciplines}
            jurisdictions={jurisdictions.filter(
              (jurisdiction) => jurisdiction.level === "subdivision",
            )}
            effectiveFromHint="Choose the calendar date it applies from. Each shift is checked against its facility's local date."
          />
        </Panel>
      ) : null}
    </div>
  );
}

/** Deliberate empty state inside a reference panel. */
function ComplianceEmpty({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-center gap-3 px-[5px] py-3">
      <span
        aria-hidden="true"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-muted text-muted-foreground [&>svg]:size-[19px]"
      >
        <WorkspaceNavIcon name="compliance" strokeWidth={2} />
      </span>
      <span className="flex flex-col">
        <span className="text-[14px] leading-5 font-medium text-slate-600">{title}</span>
        <span className="text-[12.5px] leading-[18px] text-muted-foreground">{note}</span>
      </span>
    </div>
  );
}

/** Locked filter control (Facilities): 46 px, hairline border, optional leading icon. */
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
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex h-[46px] min-w-36 items-center gap-2 rounded-md border border-chelth-border bg-white/90 pl-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring",
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
