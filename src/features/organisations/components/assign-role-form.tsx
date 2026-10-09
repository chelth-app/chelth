"use client";

import { useActionState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { Select } from "@/components/ui/select";

import { assignRoleAction } from "../actions";

type AssignRoleFormProps = {
  organisationId: string;
  membershipId: string;
  memberName: string;
  roles: { key: string; name: string }[];
};

export function AssignRoleForm({
  organisationId,
  membershipId,
  memberName,
  roles,
}: AssignRoleFormProps) {
  const [state, formAction] = useActionState(assignRoleAction, null);
  if (roles.length === 0) return null;
  const selectId = `assign-role-${membershipId}`;
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <div className="flex items-center gap-2">
        <label htmlFor={selectId} className="sr-only">
          Role to assign to {memberName}
        </label>
        <Select id={selectId} name="roleKey" defaultValue="" className="h-11 text-sm sm:h-9">
          <option value="" disabled>
            Add role…
          </option>
          {roles.map((role) => (
            <option key={role.key} value={role.key}>
              {role.name}
            </option>
          ))}
        </Select>
        <SubmitButton variant="outline" size="sm" aria-label={`Assign role to ${memberName}`}>
          Assign
        </SubmitButton>
      </div>
      <FormAlert state={state && !state.ok ? state : null} className="p-2 text-xs" />
    </form>
  );
}
