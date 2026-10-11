"use client";

import { useActionState, useEffect, useId, useState, useSyncExternalStore } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  detectDeviceTimeZone,
  listTimeZones,
  shouldSyncDeviceTimeZone,
  type TimezoneMode,
} from "@/lib/domain/display-timezone";
import { LOCALE_LABELS, SUPPORTED_LOCALES } from "@/lib/i18n/terminology";

import { syncDeviceTimezoneAction, updateDisplayPreferencesAction } from "../actions";

type Preferences = { locale: string | null; timezoneMode: TimezoneMode; timezone: string | null };

const subscribeNever = () => () => undefined;

/**
 * Timezone (P0-E9-3F): automatic by default — the device's zone, with
 * "Change" for a manual choice from a searchable list; a manual choice offers
 * "Use device timezone". Display only: shifts keep their facility's time.
 */
export function TimezonePreference({ preferences }: { preferences: Preferences }) {
  const [state, formAction] = useActionState(updateDisplayPreferencesAction, null);
  // The device zone is read on the client only (null during server render).
  const device = useSyncExternalStore(subscribeNever, detectDeviceTimeZone, () => null);
  const [changing, setChanging] = useState(false);
  const listId = useId();
  const automatic = preferences.timezoneMode === "automatic";
  const shown = automatic ? (device ?? preferences.timezone) : preferences.timezone;

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <FormAlert state={state} successMessage="Timezone saved." />
      <dl className="flex flex-col gap-0.5">
        <dt className="text-[13px] text-slate-600">
          {automatic ? "Automatically detected" : "Timezone"}
        </dt>
        <dd className="text-[15px] font-semibold text-chelth-navy" data-testid="display-timezone">
          {shown ?? "Detecting…"}
        </dd>
      </dl>
      {automatic && !changing ? (
        <button
          type="button"
          onClick={() => setChanging(true)}
          className="inline-flex min-h-11 w-fit items-center rounded-[8px] border border-[rgba(0,90,96,0.35)] bg-white px-4 text-[14px] font-semibold text-chelth-navy hover:border-chelth-teal-dark"
        >
          Change<span className="sr-only"> timezone</span>
        </button>
      ) : null}
      {!automatic ? (
        <form action={formAction}>
          <input type="hidden" name="locale" value={preferences.locale ?? ""} />
          <input type="hidden" name="timezoneMode" value="automatic" />
          <input type="hidden" name="timezone" value={device ?? ""} />
          <SubmitButton variant="outline" className="w-fit">
            Use device timezone
          </SubmitButton>
        </form>
      ) : null}
      {changing || !automatic ? (
        <form action={formAction} className="flex flex-col gap-3" noValidate>
          <input type="hidden" name="locale" value={preferences.locale ?? ""} />
          <input type="hidden" name="timezoneMode" value="manual" />
          <FormField
            id="manual-timezone"
            label="Choose a timezone"
            description="Start typing a city or region, e.g. London or Chicago."
            errors={fieldErrorsFor(state, "timezone")}
          >
            <Input
              name="timezone"
              list={listId}
              autoComplete="off"
              spellCheck={false}
              defaultValue={automatic ? "" : (preferences.timezone ?? "")}
            />
          </FormField>
          <datalist id={listId}>
            {listTimeZones().map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
          <SubmitButton variant="outline" className="w-fit">
            Save timezone
          </SubmitButton>
        </form>
      ) : null}
      <p className="text-[13px] leading-5 text-slate-600">
        Used for times such as activity and messages. Shift times always show in the facility&apos;s
        own local time.
      </p>
    </div>
  );
}

/** Language and spelling for personal pages (workspace pages follow the workspace setting). */
export function LocalePreference({ preferences }: { preferences: Preferences }) {
  const [state, formAction] = useActionState(updateDisplayPreferencesAction, null);
  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3" noValidate>
      <FormAlert state={state} successMessage="Language saved." />
      <input type="hidden" name="timezoneMode" value={preferences.timezoneMode} />
      <input type="hidden" name="timezone" value={preferences.timezone ?? ""} />
      <FormField
        id="personal-locale"
        label="Language and spelling"
        description="Your workspace may set its own spelling for shared pages."
        errors={fieldErrorsFor(state, "locale")}
      >
        <Select name="locale" defaultValue={preferences.locale ?? ""}>
          <option value="">Use my device language</option>
          {SUPPORTED_LOCALES.map((locale) => (
            <option key={locale} value={locale}>
              {LOCALE_LABELS[locale]}
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

/**
 * Keeps an AUTOMATIC display timezone in step with the device (on load and when
 * the app returns to the foreground). Manual choices are never touched (checked
 * here and enforced by the database). Renders nothing.
 */
export function DeviceTimezoneSync({
  timezoneMode,
  timezone,
}: {
  timezoneMode: TimezoneMode;
  timezone: string | null;
}) {
  useEffect(() => {
    let saved = timezone;
    let running = false;
    const sync = () => {
      const detected = detectDeviceTimeZone();
      if (running || !shouldSyncDeviceTimeZone({ timezoneMode, timezone: saved }, detected)) return;
      running = true;
      void syncDeviceTimezoneAction(detected)
        .then((result) => {
          if (result.changed) saved = detected;
        })
        .catch(() => undefined)
        .finally(() => {
          running = false;
        });
    };
    sync();
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [timezoneMode, timezone]);
  return null;
}
