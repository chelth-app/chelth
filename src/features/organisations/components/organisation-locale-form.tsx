"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { LOCALE_LABELS, SUPPORTED_LOCALES } from "@/lib/i18n/terminology";
import { useSpell } from "@/lib/i18n/terminology-context";

import { setOrganisationCurrencyAction, setOrganisationLocaleAction } from "../actions";
import type { CurrencyOption, OrganisationCurrency } from "../queries";

/** "English (United States)" — the locale label without the spelling hint. */
function languageName(label: string): string {
  return label.split(" — ")[0] ?? label;
}

/**
 * Settings → Organization → Language & Region (P0-E9-3I). Two independent
 * settings with separate saves: the language never changes the currency and
 * the currency never changes the language. Neither changes stored data.
 */
export function OrganisationLocaleForm({
  organisationId,
  locale,
}: {
  organisationId: string;
  locale: string | null;
}) {
  const [state, formAction] = useActionState(setOrganisationLocaleAction, null);
  const spell = useSpell();
  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3" noValidate>
      <FormAlert state={state} successMessage="Workspace language saved." />
      <input type="hidden" name="organisationId" value={organisationId} />
      <FormField
        id="organisation-locale"
        label="Language"
        description={spell("Controls spelling and terminology across this workspace.")}
        errors={fieldErrorsFor(state, "locale")}
      >
        <Select name="locale" defaultValue={locale ?? ""}>
          <option value="">Not set (English, United States)</option>
          {SUPPORTED_LOCALES.map((option) => (
            <option key={option} value={option}>
              {languageName(LOCALE_LABELS[option])}
            </option>
          ))}
        </Select>
      </FormField>
      <SubmitButton variant="outline" className="w-fit">
        Save language
      </SubmitButton>
    </form>
  );
}

export function OrganisationCurrencyForm({
  organisationId,
  currency,
  currencies,
}: {
  organisationId: string;
  currency: OrganisationCurrency;
  currencies: CurrencyOption[];
}) {
  const [state, formAction] = useActionState(setOrganisationCurrencyAction, null);
  const spell = useSpell();
  const lockedTo = currency.locked ? currency.currenciesInUse.join(", ") : null;
  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3" noValidate>
      <FormAlert state={state} successMessage="Workspace currency saved." />
      <input type="hidden" name="organisationId" value={organisationId} />
      <FormField
        id="organisation-currency"
        label="Currency"
        description="Used as the default currency for new rates and financial records. Amounts are never converted."
        errors={fieldErrorsFor(state, "currency")}
      >
        <Select name="currency" defaultValue={currency.effectiveCurrency}>
          {currencies.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name} ({option.code})
            </option>
          ))}
        </Select>
      </FormField>
      {lockedTo ? (
        <p role="note" className="text-[13px] leading-5 text-slate-600">
          {spell(
            `This workspace already has rates or financial records in ${lockedTo}. The currency can't be changed to another currency; existing amounts keep their own currency.`,
          )}
        </p>
      ) : currency.defaultCurrency === null ? (
        <p className="text-[13px] leading-5 text-slate-600">
          Suggested from the workspace language. Save to confirm it.
        </p>
      ) : null}
      <SubmitButton variant="outline" className="w-fit">
        Save currency
      </SubmitButton>
    </form>
  );
}
