"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { FALLBACK_LOCALE, LOCALE_LABELS, SUPPORTED_LOCALES } from "@/lib/i18n/terminology";

import { setOrganisationLocaleAction } from "../actions";

/** Workspace spelling (P0-E9-3F): presentation only; stored data never changes. */
export function OrganisationLocaleForm({
  organisationId,
  locale,
}: {
  organisationId: string;
  locale: string | null;
}) {
  const [state, formAction] = useActionState(setOrganisationLocaleAction, null);
  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3" noValidate>
      <FormAlert state={state} successMessage="Workspace language saved." />
      <input type="hidden" name="organisationId" value={organisationId} />
      <FormField
        id="organisation-locale"
        label="Language and spelling"
        description={`Spelling used across this workspace, such as License or Licence. When not set, each person's own language is used, then ${FALLBACK_LOCALE}.`}
        errors={fieldErrorsFor(state, "locale")}
      >
        <Select name="locale" defaultValue={locale ?? ""}>
          <option value="">Not set</option>
          {SUPPORTED_LOCALES.map((option) => (
            <option key={option} value={option}>
              {LOCALE_LABELS[option]}
            </option>
          ))}
        </Select>
      </FormField>
      <SubmitButton variant="outline" className="w-fit">
        Save workspace language
      </SubmitButton>
    </form>
  );
}
