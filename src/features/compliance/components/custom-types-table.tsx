"use client";

import { useActionState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { DataTableRegion } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusChip } from "@/components/ui/status-chip";
import { credentialCategoryLabel } from "@/lib/domain/credentials";
import { useSpell } from "@/lib/i18n/terminology-context";

import { setCustomTypeActiveAction } from "../actions";
import type { CustomCredentialType } from "../queries";
import { CustomTypeForm } from "./custom-type-form";

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function usedBy(type: CustomCredentialType): string {
  const parts = [
    type.requirementCount > 0 ? plural(type.requirementCount, "requirement", "requirements") : null,
    type.credentialCount > 0 ? plural(type.credentialCount, "credential", "credentials") : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Not used yet";
}

function SetActiveForm({
  organisationId,
  type,
}: {
  organisationId: string;
  type: CustomCredentialType;
}) {
  const [state, formAction] = useActionState(setCustomTypeActiveAction, null);
  const archiving = type.isActive;
  const blocked = archiving && type.activeRequirementCount > 0;
  return (
    <form action={formAction} className="flex flex-col items-start gap-1" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="key" value={type.key} />
      <input type="hidden" name="active" value={archiving ? "false" : "true"} />
      <SubmitButton
        size="sm"
        variant="outline"
        disabled={blocked}
        aria-label={`${archiving ? "Archive" : "Restore"} ${type.name}`}
      >
        {archiving ? "Archive" : "Restore"}
      </SubmitButton>
      {blocked ? (
        <p className="max-w-48 text-xs leading-4 text-slate-600">
          In use by an active requirement. Deactivate it first to archive.
        </p>
      ) : null}
      <FormAlert state={state} className="p-2 text-xs" />
    </form>
  );
}

/**
 * Settings → Compliance (P0-E9-3J): the agency's own requirement types.
 * Archiving hides a type from new requirements and new credentials; existing
 * credentials and history keep it. Nothing is ever deleted.
 */
export function CustomTypesTable({
  organisationId,
  types,
  canManage,
}: {
  organisationId: string;
  types: CustomCredentialType[];
  canManage: boolean;
}) {
  const spell = useSpell();
  if (types.length === 0) {
    return <EmptyState headingLevel={3} title="No custom requirements yet." />;
  }
  return (
    <DataTableRegion aria-label="Custom credential types table" className="mb-3">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <caption className="sr-only">Custom credential types</caption>
        <thead className="border-b border-border bg-surface-muted text-[13px] text-slate-600">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Name
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Category
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Used by
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
            {canManage ? (
              <th scope="col" className="px-3 py-2 font-medium">
                Actions
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {types.map((type) => (
            <tr key={type.key} className="align-top">
              <th scope="row" className="px-3 py-3 font-medium text-foreground">
                {type.name}
              </th>
              <td className="px-3 py-3">{spell(credentialCategoryLabel(type.category))}</td>
              <td className="px-3 py-3 text-slate-600">{usedBy(type)}</td>
              <td className="px-3 py-3">
                <StatusChip tone={type.isActive ? "success" : "neutral"}>
                  {type.isActive ? "Active" : "Archived"}
                </StatusChip>
              </td>
              {canManage ? (
                <td className="px-3 py-3">
                  <div className="flex flex-col items-start gap-2">
                    {type.isActive ? (
                      <details className="text-sm">
                        <summary
                          className="cursor-pointer text-primary"
                          aria-label={`Edit ${type.name}`}
                        >
                          Edit
                        </summary>
                        <div className="mt-3 w-[min(36rem,80vw)]">
                          <CustomTypeForm
                            organisationId={organisationId}
                            idPrefix={`custom-${type.key}`}
                            initial={type}
                          />
                        </div>
                      </details>
                    ) : null}
                    <SetActiveForm organisationId={organisationId} type={type} />
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableRegion>
  );
}

/** "+ Add custom requirement" on Settings → Compliance. */
export function AddCustomTypePanel({ organisationId }: { organisationId: string }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium text-primary">
        + Add custom requirement
      </summary>
      <div className="mt-3 max-w-2xl">
        <CustomTypeForm organisationId={organisationId} idPrefix="custom-new" />
      </div>
    </details>
  );
}
