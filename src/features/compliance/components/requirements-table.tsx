import { InlineActionForm } from "@/components/forms/inline-action-form";
import { Badge } from "@/components/ui/badge";

import { updateRequirementAction } from "../actions";
import type { Requirement } from "../queries";

type RequirementsTableProps = {
  organisationId: string;
  facilityId?: string;
  requirements: Requirement[];
  typeNames: Map<string, string>;
  disciplineNames: Map<string, string>;
  canManage: boolean;
  label: string;
};

export function RequirementsTable(props: RequirementsTableProps) {
  const { organisationId, facilityId, requirements, typeNames, disciplineNames, canManage, label } =
    props;
  if (requirements.length === 0) {
    return <p className="text-sm text-muted-foreground">No requirements yet.</p>;
  }
  return (
    <ul
      aria-label={label}
      className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface text-sm"
    >
      {requirements.map((requirement) => (
        <li key={requirement.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
          <div className="flex flex-col gap-1">
            <span className="font-medium">
              {typeNames.get(requirement.credentialTypeKey) ?? requirement.credentialTypeKey}
            </span>
            <span className="text-muted-foreground">
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
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={requirement.status === "active" ? "success" : "neutral"}>
              {requirement.status === "active" ? "Active" : "Inactive"}
            </Badge>
            {canManage && requirement.status === "active" ? (
              <InlineActionForm
                action={updateRequirementAction}
                fields={{
                  organisationId,
                  ...(facilityId ? { facilityId } : {}),
                  requirementId: requirement.id,
                  mustBeVerified: String(requirement.mustBeVerified),
                  minimumValidityDays: String(requirement.minimumValidityDays),
                  expiryWarningDays: String(requirement.expiryWarningDays),
                  status: "inactive",
                }}
                label="Deactivate"
                accessibleLabel={`Deactivate ${typeNames.get(requirement.credentialTypeKey) ?? "requirement"}`}
                variant="ghost"
              />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
