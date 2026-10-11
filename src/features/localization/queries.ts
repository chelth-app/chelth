import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { getMyProfile } from "@/features/identity";
import { getOrganisation } from "@/features/organisations";

import { ORGANISATION_HINT_HEADER, organisationIdFromPath } from "@/lib/i18n/organisation-hint";
import {
  localeFromAcceptLanguage,
  localizeTerms,
  resolveLocale,
  type Terminology,
  terminology,
} from "@/lib/i18n/terminology";

/*
 * Request-scoped terminology for server components (P0-E9-3F). Reads the
 * organisation and profile locale through the caller's own RLS-scoped
 * (memoised) queries and the browser's Accept-Language as the device fallback.
 */

const deviceLocale = cache(async () =>
  localeFromAcceptLanguage((await headers()).get("accept-language")),
);

/** Workspace surfaces: organisation locale → user → device → fallback. */
export const getWorkspaceTerminology = cache(
  async (organisationId: string): Promise<Terminology> => {
    const [organisation, profile, device] = await Promise.all([
      getOrganisation(organisationId),
      getMyProfile(),
      deviceLocale(),
    ]);
    return terminology(
      resolveLocale("workspace", {
        organisationLocale: organisation?.locale ?? null,
        userLocale: profile.locale,
        deviceLocale: device,
      }),
    );
  },
);

/** Personal surfaces: user → device → fallback. */
export const getPersonalTerminology = cache(async (): Promise<Terminology> => {
  const [profile, device] = await Promise.all([getMyProfile(), deviceLocale()]);
  return terminology(
    resolveLocale("personal", { userLocale: profile.locale, deviceLocale: device }),
  );
});

/**
 * Terminology for the current request: the workspace's when the URL is inside
 * an organisation (proxy hint, re-validated here and re-read through RLS),
 * otherwise the person's own. Used where reference data (credential type
 * names) is mapped for display.
 */
export const getRequestTerminology = cache(async (): Promise<Terminology> => {
  const hint = (await headers()).get(ORGANISATION_HINT_HEADER);
  const organisationId = hint ? organisationIdFromPath(`/app/organisations/${hint}`) : null;
  return organisationId ? getWorkspaceTerminology(organisationId) : getPersonalTerminology();
});

/** Display form of reference-data text for this request (e.g. credential type names). */
export async function localizeForRequest(text: string): Promise<string> {
  return localizeTerms(text, await getRequestTerminology());
}
