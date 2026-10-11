import { describe, expect, it } from "vitest";

import { ERROR_CODES, normalizeError } from "@/lib/errors";
import { formatMoney } from "@/lib/domain/pricing";
import {
  localizeTerms,
  resolveLocale,
  suggestedCurrency,
  terminology,
} from "@/lib/i18n/terminology";

/* P0-E9-3I: app-wide spelling, Language & Region, currency safety (presentation). */

const US = terminology("en-US");
const GB = terminology("en-GB");

describe("terminology", () => {
  it.each([
    ["organization", "organisation"],
    ["organizations", "organisations"],
    ["license", "licence"],
    ["licenses", "licences"],
    ["authorized", "authorised"],
    ["unauthorized", "unauthorised"],
    ["authorization", "authorisation"],
    ["center", "centre"],
    ["centers", "centres"],
    ["meters", "metres"],
    ["behavior", "behaviour"],
    ["canceled", "cancelled"],
    ["canceling", "cancelling"],
    ["labor", "labour"],
    ["recognize", "recognise"],
  ])("en-US %s ⇄ en-GB %s", (american, british) => {
    expect(localizeTerms(american, GB)).toBe(british);
    expect(localizeTerms(british, US)).toBe(american);
    expect(localizeTerms(american, US)).toBe(american);
    expect(localizeTerms(british, GB)).toBe(british);
  });

  it("keeps case and only whole words", () => {
    expect(localizeTerms("Organization suspended", GB)).toBe("Organisation suspended");
    expect(localizeTerms("CANCELED", GB)).toBe("CANCELLED");
    expect(localizeTerms("Remove from organization", GB)).toBe("Remove from organisation");
    expect(localizeTerms("parameter recentered", GB)).toBe("parameter recentered");
    // Sentence punctuation is prose; a dot followed by a word is a key.
    expect(localizeTerms("Remove them from the organization.", GB)).toBe(
      "Remove them from the organisation.",
    );
    expect(localizeTerms("Shift canceled, then reopened?", GB)).toBe(
      "Shift cancelled, then reopened?",
    );
  });

  it("identifiers, routes and keys are not words to respell", () => {
    expect(localizeTerms("/app/organisations/123/settings", US)).toBe(
      "/app/organisations/123/settings",
    );
    expect(localizeTerms("organisationId organisation_id organisation.manage", US)).toBe(
      "organisationId organisation_id organisation.manage",
    );
  });

  it("explicit terms for components", () => {
    expect([US.organization, US.organizations, US.canceled]).toEqual([
      "Organization",
      "Organizations",
      "Canceled",
    ]);
    expect([GB.organization, GB.organizations, GB.canceled]).toEqual([
      "Organisation",
      "Organisations",
      "Cancelled",
    ]);
  });

  it("a US workspace stays American for a British user abroad (workspace precedence)", () => {
    expect(
      resolveLocale("workspace", {
        organisationLocale: "en-US",
        userLocale: "en-GB",
        deviceLocale: "en-GB",
      }),
    ).toBe("en-US");
    expect(resolveLocale("personal", { userLocale: "en-GB", deviceLocale: "en-US" })).toBe("en-GB");
    expect(resolveLocale("workspace", {})).toBe("en-US");
  });
});

describe("currency (configuration and formatting only)", () => {
  it("a new workspace's language may SUGGEST a currency; it is never forced", () => {
    expect(suggestedCurrency("en-US")).toBe("USD");
    expect(suggestedCurrency("en-GB")).toBe("GBP");
    expect(suggestedCurrency(null)).toBe("USD");
  });

  it("formats money by currency code through Intl — no symbol concatenation, no conversion", () => {
    expect(formatMoney(125000, "USD")).toBe("$1,250.00");
    expect(formatMoney(125000, "GBP")).toBe("£1,250.00");
    expect(formatMoney(125000, "EUR")).toBe("€1,250.00");
    // The amount is the stored minor units: the same number in every currency.
    for (const currency of ["USD", "GBP", "EUR"]) {
      expect(formatMoney(3000, currency)).toMatch(/30\.00$/);
    }
  });

  it("a refused currency change is explained in plain words", () => {
    const error = normalizeError({
      code: "CHY22",
      message: "financial records already use another currency",
    });
    expect(error.code).toBe("CURRENCY_IN_USE");
    expect(ERROR_CODES.CURRENCY_IN_USE.message).toBe(
      "Currency can't be changed because this workspace already has rates or financial records in another currency.",
    );
  });
});
