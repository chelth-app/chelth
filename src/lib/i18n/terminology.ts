/**
 * Presentation terminology (P0-E9-3F). Spelling and wording only: database
 * values, enum keys, API fields and credential type keys (e.g. `rn_license`)
 * never change with the locale.
 *
 * Supported: en-US ("License"), en-GB ("Licence"). Any other locale uses the
 * documented fallback, FALLBACK_LOCALE (en-US: Chelth's first market). Locales
 * are not guessed country by country, and physical location is never used —
 * a US agency user travelling in London still sees "License".
 *
 * Precedence (resolveLocale):
 *   workspace surfaces: organisation locale → user locale → device / browser
 *   personal surfaces:  user locale → device / browser
 *   then FALLBACK_LOCALE.
 */

export const SUPPORTED_LOCALES = ["en-US", "en-GB"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const FALLBACK_LOCALE: SupportedLocale = "en-US";

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  "en-US": "English (United States) — License",
  "en-GB": "English (United Kingdom) — Licence",
};

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Exact match only (en-US, en-GB). en-AU, en-IE, fr-FR … are not guessed: they fall through. */
export function supportedLocaleOf(tag: string | null | undefined): SupportedLocale | null {
  if (!tag) return null;
  const [language = "", region = ""] = tag.trim().replace("_", "-").split("-");
  const normalised = `${language.toLowerCase()}-${region.toUpperCase()}`;
  return isSupportedLocale(normalised) ? normalised : null;
}

/** First supported tag of an Accept-Language header (quality order respected). */
export function localeFromAcceptLanguage(
  header: string | null | undefined,
): SupportedLocale | null {
  if (!header) return null;
  const tags = header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.find((param) => param.trim().startsWith("q="));
      return { tag, q: q ? Number(q.trim().slice(2)) || 0 : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of tags) {
    const supported = supportedLocaleOf(tag);
    if (supported) return supported;
  }
  return null;
}

export type LocaleSources = {
  /** Configured on the workspace; only consulted for workspace surfaces. */
  organisationLocale?: string | null;
  userLocale?: string | null;
  /** Browser / device language (Accept-Language or navigator.language). */
  deviceLocale?: string | null;
};

export function resolveLocale(
  surface: "workspace" | "personal",
  sources: LocaleSources,
): SupportedLocale {
  const chain =
    surface === "workspace"
      ? [sources.organisationLocale, sources.userLocale, sources.deviceLocale]
      : [sources.userLocale, sources.deviceLocale];
  for (const candidate of chain) {
    const supported = supportedLocaleOf(candidate);
    if (supported) return supported;
  }
  return FALLBACK_LOCALE;
}

/**
 * Spelling pairs Chelth's UI actually uses (P0-E9-3I), [en-US, en-GB].
 * Whole words only, case kept (organization / Organization / ORGANIZATION).
 * Source copy is written in American English (the fallback locale); en-GB
 * respells it. Reference data stored in British spelling (e.g. a credential
 * type "… licence") is respelled for en-US the same way.
 *
 * Context rules:
 * - "license" is used in Chelth only as a NOUN (a professional credential).
 *   In British English the noun is "licence" and the verb "license"; Chelth
 *   has no verb use, so the pair is noun-only. Add explicit copy (not a pair)
 *   if a verb is ever needed.
 * - "program" (software) is not respelled; Chelth has no "programme" copy.
 * - Never applied to names people type (facility "Riverside Care Center"),
 *   identifiers, routes or URLs: only to Chelth's own copy and reference
 *   vocabulary.
 */
const SPELLING_PAIRS: readonly (readonly [string, string])[] = [
  ["organizations", "organisations"],
  ["organization", "organisation"],
  ["licenses", "licences"],
  ["license", "licence"],
  ["canceled", "cancelled"],
  ["canceling", "cancelling"],
  ["centers", "centres"],
  ["center", "centre"],
  ["meters", "metres"],
  ["meter", "metre"],
  ["authorized", "authorised"],
  ["unauthorized", "unauthorised"],
  ["authorization", "authorisation"],
  ["recognize", "recognise"],
  ["behavior", "behaviour"],
  ["labor", "labour"],
  ["color", "colour"],
  ["fulfillment", "fulfilment"],
  ["enrollment", "enrolment"],
  ["catalog", "catalogue"],
  ["gray", "grey"],
] as const;

export type Terminology = {
  locale: SupportedLocale;
  /** "License" / "Licence" */
  license: string;
  /** "Licenses" / "Licences" */
  licenses: string;
  /** "license" / "licence" (mid-sentence) */
  licenseLower: string;
  licensesLower: string;
  professionalLicense: string;
  licenseNumber: string;
  /** "Organization" / "Organisation" */
  organization: string;
  /** "Organizations" / "Organisations" */
  organizations: string;
  /** "Canceled" / "Cancelled" */
  canceled: string;
};

const TERMS: Record<SupportedLocale, Terminology> = {
  "en-US": {
    locale: "en-US",
    license: "License",
    licenses: "Licenses",
    licenseLower: "license",
    licensesLower: "licenses",
    professionalLicense: "Professional License",
    licenseNumber: "License / certificate number",
    organization: "Organization",
    organizations: "Organizations",
    canceled: "Canceled",
  },
  "en-GB": {
    locale: "en-GB",
    license: "Licence",
    licenses: "Licences",
    licenseLower: "licence",
    licensesLower: "licences",
    professionalLicense: "Professional Licence",
    licenseNumber: "Licence / certificate number",
    organization: "Organisation",
    organizations: "Organisations",
    canceled: "Cancelled",
  },
};

export function terminology(locale: SupportedLocale = FALLBACK_LOCALE): Terminology {
  return TERMS[locale];
}

const BY_VARIANT = new Map<string, readonly [string, string]>(
  SPELLING_PAIRS.flatMap((pair) => [
    [pair[0], pair],
    [pair[1], pair],
  ]),
);
// Whole words in prose only: a word touching / . _ - or a letter/digit is part
// of a route, URL, key or identifier (e.g. /app/organisations/…,
// organisation.manage) and is never respelled.
const WORD = new RegExp(
  `(?<![\\w/._-])(${[...BY_VARIANT.keys()].sort((a, b) => b.length - a.length).join("|")})(?![\\w/_-]|\\.\\w)`,
  "gi",
);

function keepCase(source: string, target: string): string {
  if (source === source.toUpperCase()) return target.toUpperCase();
  if (source[0] === source[0]?.toUpperCase()) return target[0]?.toUpperCase() + target.slice(1);
  return target;
}

/**
 * Respells Chelth's own display text for a locale (whole words, case kept).
 * Only for copy and reference vocabulary — never for user-entered names,
 * identifiers, routes or URLs.
 */
export function localizeTerms(text: string, terms: Terminology): string {
  const index = terms.locale === "en-GB" ? 1 : 0;
  return text.replace(WORD, (match) => {
    const pair = BY_VARIANT.get(match.toLowerCase());
    return pair ? keepCase(match, pair[index]) : match;
  });
}

/** Currency suggested for a NEW workspace by its language (never forced; see P0-E9-3I). */
export function suggestedCurrency(locale: SupportedLocale | null | undefined): string {
  return locale === "en-GB" ? "GBP" : "USD";
}
