import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { ORGANISATION_HINT_HEADER, organisationIdFromPath } from "./organisation-hint";
import {
  localeFromAcceptLanguage,
  localizeTerms,
  resolveLocale,
  type Terminology,
  terminology,
} from "./terminology";

/*
 * Request-scoped terminology (P0-E9-3F / P0-E9-3I). Reads the organisation and
 * profile locale through the caller's own RLS-scoped queries and the browser's
 * Accept-Language as the device fallback. Lives in lib (not a feature) so the
 * Server Action error layer can use it without import cycles.
 */

const organisationLocale = cache(async (organisationId: string): Promise<string | null> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("organisations")
    .select("locale")
    .eq("id", organisationId)
    .maybeSingle();
  return data?.locale ?? null;
});

/** The signed-in person's own locale (null when signed out or not set). */
const profileLocale = cache(async (): Promise<string | null> => {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("locale")
    .eq("id", auth.user.id)
    .maybeSingle();
  return data?.locale ?? null;
});

const deviceLocale = cache(async () =>
  localeFromAcceptLanguage((await headers()).get("accept-language")),
);

/** Workspace surfaces: organisation locale → user → device → en-US. */
export const getWorkspaceTerminology = cache(
  async (organisationId: string): Promise<Terminology> => {
    const [org, user, device] = await Promise.all([
      organisationLocale(organisationId),
      profileLocale(),
      deviceLocale(),
    ]);
    return terminology(
      resolveLocale("workspace", {
        organisationLocale: org,
        userLocale: user,
        deviceLocale: device,
      }),
    );
  },
);

/** Personal surfaces: user → device → en-US. */
export const getPersonalTerminology = cache(async (): Promise<Terminology> => {
  const [user, device] = await Promise.all([profileLocale(), deviceLocale()]);
  return terminology(resolveLocale("personal", { userLocale: user, deviceLocale: device }));
});

/** Signed-out pages (sign-in, sign-up, invitations): browser language, then en-US. */
export const getDeviceTerminology = cache(async (): Promise<Terminology> =>
  terminology(resolveLocale("personal", { deviceLocale: await deviceLocale() })),
);

/*
 * For SYNCHRONOUS rendering: server components call spell("…"). The value is
 * set by getRequestTerminology(), which loadOrganisationPage() awaits before a
 * workspace page renders. Unresolved ⇒ the American source text (fallback).
 */
const requestTerms = cache((): { current: Terminology | null } => ({ current: null }));

/**
 * The workspace's terminology when the URL is inside an organisation (proxy
 * hint, re-validated, re-read through RLS), otherwise the person's own.
 */
export const getRequestTerminology = cache(async (): Promise<Terminology> => {
  const hint = (await headers()).get(ORGANISATION_HINT_HEADER);
  const organisationId = hint ? organisationIdFromPath(`/app/organisations/${hint}`) : null;
  const terms = organisationId
    ? await getWorkspaceTerminology(organisationId)
    : await getPersonalTerminology();
  requestTerms().current = terms;
  return terms;
});

export function currentTerms(): Terminology {
  return requestTerms().current ?? terminology();
}

/** Chelth copy / label text in the request's spelling. Never for user-entered names. */
export function spell(text: string): string {
  const terms = requestTerms().current;
  return terms ? localizeTerms(text, terms) : text;
}

/** Display form of reference-data text for this request (e.g. credential type names). */
export async function localizeForRequest(text: string): Promise<string> {
  return localizeTerms(text, await getRequestTerminology());
}

/**
 * Non-operational date / time display in the request's locale (P0-E9-3I):
 * en-US "Oct 11, 2026, 2:45 AM", en-GB "11 Oct 2026, 02:45". Formatting only —
 * pass the same timeZone as before; instants and facility dates never change.
 * Resolved when called, so a module-level formatter follows the request.
 */
export function requestDateFormat(options: Intl.DateTimeFormatOptions): {
  format: (value: Date) => string;
} {
  return {
    format: (value: Date) => new Intl.DateTimeFormat(currentTerms().locale, options).format(value),
  };
}
