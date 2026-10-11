"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CREDENTIAL_CATEGORIES,
  CREDENTIAL_CATEGORY_LABELS,
  RENEWAL_INTERVAL_MONTHS,
} from "@/lib/domain/credentials";
import { useSpell } from "@/lib/i18n/terminology-context";

import { createCustomTypeAction, updateCustomTypeAction } from "../actions";
import type { CustomCredentialType } from "../queries";

type CustomTypeFormProps = {
  organisationId: string;
  /** Prefix for field ids, so two forms can share a page. */
  idPrefix: string;
  /** Edit an existing type; omitted ⇒ create. */
  initial?: CustomCredentialType;
  /** Create only: called with the new key (e.g. to preselect it in a requirement form). */
  onCreated?: (key: string) => void;
  onCancel?: () => void;
};

const EVIDENCE_RULES = [
  { name: "requiresDocument", label: "Requires a document upload", field: "requiresDocument" },
  { name: "requiresExpiryDate", label: "Has an expiry date", field: "requiresExpiryDate" },
  {
    name: "requiresVerification",
    label: "Must be verified by the agency",
    field: "requiresVerification",
  },
  {
    name: "requiresCredentialNumber",
    label: "Requires a credential number",
    field: "requiresCredentialNumber",
  },
] as const;

/**
 * P0-E9-3J: create or edit an agency-defined requirement type. The name,
 * category and worker instructions are always editable; once the type is in
 * use, its evidence rules are locked (the database enforces this too).
 */
export function CustomTypeForm({
  organisationId,
  idPrefix,
  initial,
  onCreated,
  onCancel,
}: CustomTypeFormProps) {
  const spell = useSpell();
  const [createState, createAction] = useActionState(createCustomTypeAction, null);
  const [updateState, updateAction] = useActionState(updateCustomTypeAction, null);
  const state = initial ? updateState : createState;
  const locked = initial ? initial.requirementCount > 0 || initial.credentialCount > 0 : false;
  // A renewal interval is the alternative to an expiry date: the engine counts
  // expiry from the issue date. Only offered when there is no expiry date.
  const [hasExpiry, setHasExpiry] = useState(initial?.requiresExpiryDate ?? true);
  const showRenewal = !hasExpiry || Boolean(initial?.validityMonths);

  const reported = useRef<unknown>(null);
  useEffect(() => {
    if (!onCreated || !createState?.ok || reported.current === createState) return;
    reported.current = createState;
    onCreated(createState.data.key);
  }, [createState, onCreated]);

  const id = (field: string) => `${idPrefix}-${field}`;
  return (
    <form
      action={initial ? updateAction : createAction}
      className="grid gap-3 sm:grid-cols-2"
      noValidate
    >
      <input type="hidden" name="organisationId" value={organisationId} />
      {initial ? <input type="hidden" name="key" value={initial.key} /> : null}
      <FormField id={id("name")} label="Name" required errors={fieldErrorsFor(state, "name")}>
        <Input name="name" maxLength={120} defaultValue={initial?.name ?? ""} autoComplete="off" />
      </FormField>
      <FormField
        id={id("category")}
        label="Category"
        required
        errors={fieldErrorsFor(state, "category")}
      >
        <Select name="category" defaultValue={initial?.category ?? ""}>
          <option value="" disabled>
            Choose a category
          </option>
          {CREDENTIAL_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {spell(CREDENTIAL_CATEGORY_LABELS[category])}
            </option>
          ))}
        </Select>
      </FormField>

      <fieldset className="flex flex-col gap-2 sm:col-span-2">
        <legend className="mb-1 text-sm font-medium text-foreground">Evidence rules</legend>
        {locked ? (
          <p role="note" className="text-[13px] leading-5 text-slate-600">
            This requirement is in use, so its evidence rules can&apos;t change. Create a new custom
            requirement if the rules need to be different.
          </p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {EVIDENCE_RULES.map((rule) => {
            const checked = initial
              ? initial[rule.field]
              : rule.field !== "requiresCredentialNumber";
            return (
              <label key={rule.name} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name={locked ? undefined : rule.name}
                  defaultChecked={checked}
                  disabled={locked}
                  className="size-4"
                  {...(rule.field === "requiresExpiryDate"
                    ? { onChange: (event) => setHasExpiry(event.target.checked) }
                    : {})}
                />
                {rule.label}
                {locked && checked ? <input type="hidden" name={rule.name} value="on" /> : null}
              </label>
            );
          })}
        </div>
      </fieldset>

      <FormField
        id={id("jurisdiction")}
        label="Issuing jurisdiction"
        errors={fieldErrorsFor(state, "jurisdictionRule")}
      >
        <Select
          name={locked ? undefined : "jurisdictionRule"}
          defaultValue={initial?.jurisdictionRule ?? "none"}
          disabled={locked}
        >
          <option value="none">Not needed</option>
          <option value="country">Country</option>
          <option value="subdivision">State or province</option>
        </Select>
      </FormField>
      {locked && initial ? (
        <input type="hidden" name="jurisdictionRule" value={initial.jurisdictionRule} />
      ) : null}
      {showRenewal ? (
        <FormField
          id={id("renewal")}
          label="Renewal interval"
          description="Counted from the issue date the worker enters."
          errors={fieldErrorsFor(state, "validityMonths")}
        >
          <Select
            name={locked ? undefined : "validityMonths"}
            defaultValue={initial?.validityMonths ? String(initial.validityMonths) : ""}
            disabled={locked}
          >
            <option value="">No fixed interval</option>
            {RENEWAL_INTERVAL_MONTHS.map((months) => (
              <option key={months} value={months}>
                {months % 12 === 0
                  ? `Every ${months / 12} year${months === 12 ? "" : "s"}`
                  : `Every ${months} months`}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      {locked && initial?.validityMonths ? (
        <input type="hidden" name="validityMonths" value={initial.validityMonths} />
      ) : null}

      <FormField
        id={id("instructions")}
        label="Instructions for workers"
        description="Shown to workers when they add this requirement. Optional."
        errors={fieldErrorsFor(state, "instructions")}
        className="sm:col-span-2"
      >
        <Textarea
          name="instructions"
          rows={3}
          maxLength={1000}
          defaultValue={initial?.instructions ?? ""}
        />
      </FormField>

      <div className="flex flex-col gap-2 sm:col-span-2">
        <FormAlert
          state={state}
          successMessage={initial ? "Custom requirement saved." : "Custom requirement created."}
        />
        <div className="flex flex-wrap gap-2">
          <SubmitButton className="w-fit" variant="outline">
            {initial ? "Save changes" : "Create custom requirement"}
          </SubmitButton>
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
