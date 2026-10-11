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
  },
  "en-GB": {
    locale: "en-GB",
    license: "Licence",
    licenses: "Licences",
    licenseLower: "licence",
    licensesLower: "licences",
    professionalLicense: "Professional Licence",
    licenseNumber: "Licence / certificate number",
  },
};

export function terminology(locale: SupportedLocale = FALLBACK_LOCALE): Terminology {
  return TERMS[locale];
}

/**
 * Display text that came from reference data (e.g. the credential type name
 * "Registered Nurse (RN) licence"): only the licence / license word is
 * respelled, with its case kept. Never applied to identifiers.
 */
export function localizeTerms(text: string, terms: Terminology): string {
  return text.replace(/\b(licen[cs]e)(s?)\b/gi, (match, _word: string, plural: string) => {
    const base = plural ? terms.licensesLower : terms.licenseLower;
    if (match === match.toUpperCase()) return base.toUpperCase();
    if (match[0] === match[0]?.toUpperCase()) return base[0]?.toUpperCase() + base.slice(1);
    return base;
  });
}
