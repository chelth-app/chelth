import { EmptyState } from "@/components/ui/empty-state";
import { StatusChip } from "@/components/ui/status-chip";
import { formatCalendarDate } from "@/lib/domain/credentials";

import type { Requirement } from "../queries";
import { DeactivateRequirementForm } from "./deactivate-requirement-form";

type RequirementsTableProps = {
  organisationId: string;
  facilityId?: string;
  requirements: Requirement[];
  typeNames: Map<string, string>;
  disciplineNames: Map<string, string>;
  canManage: boolean;
  label: string;
  /** Default "last day" for deactivation: the facility's local date (facility pages only). */
  defaultLastDay?: string;
};

export function RequirementsTable(props: RequirementsTableProps) {
  const {
    organisationId,
    facilityId,
    requirements,
    typeNames,
    disciplineNames,
    canManage,
    label,
    defaultLastDay,
  } = props;
  if (requirements.length === 0) {
    return <EmptyState headingLevel={3} title="No requirements yet." />;
  }
  return (
    <ul
      aria-label={label}
      className="flex flex-col divide-y divide-border border-y border-border text-sm in-[.chelth-locked]:divide-[rgba(18,107,103,0.12)] in-[.chelth-locked]:border-[rgba(18,107,103,0.12)]"
    >
      {requirements.map((requirement) => (
        <li
          key={requirement.id}
          className="flex flex-wrap items-center justify-between gap-2 p-3 in-[.chelth-locked]:py-3.5"
        >
          <div className="flex flex-col gap-1">
            <span className="font-medium in-[.chelth-locked]:text-[15px] in-[.chelth-locked]:font-semibold in-[.chelth-locked]:text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]">
              {typeNames.get(requirement.credentialTypeKey) ?? requirement.credentialTypeKey}
            </span>
            <span className="text-muted-foreground in-[.chelth-locked]:font-medium in-[.chelth-locked]:text-slate-600">
              {requirement.disciplineKey
                ? disciplineNames.get(requirement.disciplineKey)
                : "All workers"}
              {requirement.jurisdictionCode ? ` · ${requirement.jurisdictionCode}` : ""}
              {requirement.mustBeVerified ? " · verified" : ""}
              {requirement.minimumValidityDays > 0
                ? ` · valid ≥ ${requirement.minimumValidityDays} days`
                : ""}
              {` · warn ${requirement.expiryWarningDays} days`}
            </span>
            <span className="text-muted-foreground in-[.chelth-locked]:text-slate-600">
              From {formatCalendarDate(requirement.effectiveFrom)}
              {requirement.effectiveUntil
                ? ` to ${formatCalendarDate(requirement.effectiveUntil)}`
                : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <StatusChip tone={requirement.status === "active" ? "success" : "neutral"}>
              {requirement.status === "active" ? "Active" : "Inactive"}
            </StatusChip>
            {canManage && requirement.status === "active" ? (
              <DeactivateRequirementForm
                organisationId={organisationId}
                {...(facilityId ? { facilityId } : {})}
                requirement={requirement}
                name={typeNames.get(requirement.credentialTypeKey) ?? "requirement"}
                {...(defaultLastDay ? { defaultLastDay } : {})}
              />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
