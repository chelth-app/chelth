import { describe, expect, it } from "vitest";

import {
  detectDeviceTimeZone,
  isValidTimeZone,
  resolveDisplayTimeZone,
  shouldSyncDeviceTimeZone,
} from "@/lib/domain/display-timezone";
import {
  checkFacilityImageFile,
  fitWithin,
  MAX_FACILITY_IMAGE_BYTES,
} from "@/lib/domain/facility-images";
import {
  amountForMinutes,
  describeRounding,
  formatHoursMinutes,
  pricedMinutes,
  roundingInEffect,
  SHIFT_CLASSIFICATION_LABELS,
  SHIFT_CLASSIFICATIONS,
  shiftClassificationPhrase,
} from "@/lib/domain/pricing";
import { shiftPeriod } from "@/lib/domain/shifts";
import { organisationIdFromPath } from "@/lib/i18n/organisation-hint";
import {
  FALLBACK_LOCALE,
  localeFromAcceptLanguage,
  localizeTerms,
  resolveLocale,
  supportedLocaleOf,
  terminology,
} from "@/lib/i18n/terminology";

describe("Day Shift vocabulary (P0-E9-3F)", () => {
  it("the stored key stays `regular`; it is shown as Day Shift", () => {
    expect(SHIFT_CLASSIFICATIONS).toContain("regular");
    expect(SHIFT_CLASSIFICATION_LABELS.regular).toBe("Day Shift");
    expect(Object.values(SHIFT_CLASSIFICATION_LABELS)).not.toContain("Regular");
  });

  it("Day Shift never stands for evening, night or weekend", () => {
    expect(SHIFT_CLASSIFICATION_LABELS.evening).toBe("Evening");
    expect(SHIFT_CLASSIFICATION_LABELS.night).toBe("Night");
    expect(SHIFT_CLASSIFICATION_LABELS.weekend).toBe("Weekend");
    expect(shiftClassificationPhrase("regular")).toBe("Day Shift");
    expect(shiftClassificationPhrase("night")).toBe("Night shift");
  });
});

describe("exact-minute calculation (mirrors the database engine)", () => {
  const usd30 = 3000;
  it.each([
    [60, 3000n],
    [30, 1500n],
    [457, 22850n],
    [0, 0n],
  ])("$30/hour × %i min", (minutes, expected) => {
    expect(amountForMinutes(usd30, minutes)).toBe(expected);
  });

  it("decimal hourly rates round half up only at the cent", () => {
    expect(amountForMinutes(3125, 457)).toBe(23802n); // 238.0208…
    expect(amountForMinutes(2999, 1)).toBe(50n); // 49.98… → 50
  });

  it("an overnight shift or a shift with breaks is priced from its worked minutes only", () => {
    // 19:00 → 07:30 with a 30-minute break = 690 worked minutes (the snapshot's value).
    expect(amountForMinutes(usd30, 690)).toBe(34500n);
  });

  it("exact minutes vs the existing rounding policy", () => {
    expect(pricedMinutes(457, "none", null)).toBe(457);
    expect(pricedMinutes(457, "nearest", 15)).toBe(450);
    expect(pricedMinutes(453, "nearest", 15)).toBe(450);
    expect(pricedMinutes(458, "nearest", 15)).toBe(465); // 457.5 is the midpoint
    expect(describeRounding("none", null)).toBe("Exact minutes");
    expect(formatHoursMinutes(457)).toBe("7h 37m");
  });

  it("the method in effect is the latest active policy starting on or before the date", () => {
    const policies = [
      {
        status: "active",
        effectiveFrom: "2026-01-01",
        roundingMode: "nearest" as const,
        increment: 15,
      },
      {
        status: "active",
        effectiveFrom: "2026-10-12",
        roundingMode: "none" as const,
        increment: null,
      },
      {
        status: "draft",
        effectiveFrom: "2026-10-01",
        roundingMode: "none" as const,
        increment: null,
      },
    ];
    expect(roundingInEffect(policies, "2026-10-10")?.roundingMode).toBe("nearest");
    expect(roundingInEffect(policies, "2026-10-12")?.roundingMode).toBe("none");
    expect(roundingInEffect([], "2026-10-10")).toBeNull(); // no policy ⇒ exact minutes
  });
});

describe("License / Licence terminology", () => {
  it("en-US: License · en-GB: Licence", () => {
    expect(terminology("en-US").license).toBe("License");
    expect(terminology("en-US").professionalLicense).toBe("Professional License");
    expect(terminology("en-GB").license).toBe("Licence");
    expect(terminology("en-GB").licenses).toBe("Licences");
  });

  it("reference names are respelled for display, keeping case", () => {
    const us = terminology("en-US");
    const gb = terminology("en-GB");
    expect(localizeTerms("Registered Nurse (RN) licence", us)).toBe(
      "Registered Nurse (RN) license",
    );
    expect(localizeTerms("RN License", gb)).toBe("RN Licence");
    expect(localizeTerms("LICENCES", us)).toBe("LICENSES");
    expect(localizeTerms("Basic Life Support (BLS)", gb)).toBe("Basic Life Support (BLS)");
  });

  it("identifiers are never touched by presentation", () => {
    // Identifiers do not pass through localizeTerms; even if they did, word boundaries keep them.
    expect(localizeTerms("rn_license", terminology("en-GB"))).toBe("rn_license");
  });

  it("workspace precedence: organisation → user → device → fallback", () => {
    expect(resolveLocale("workspace", { organisationLocale: "en-GB", userLocale: "en-US" })).toBe(
      "en-GB",
    );
    expect(resolveLocale("workspace", { userLocale: "en-GB", deviceLocale: "en-US" })).toBe(
      "en-GB",
    );
    expect(resolveLocale("workspace", { deviceLocale: "en-GB" })).toBe("en-GB");
    expect(resolveLocale("workspace", {})).toBe(FALLBACK_LOCALE);
  });

  it("personal precedence ignores the organisation", () => {
    expect(resolveLocale("personal", { organisationLocale: "en-GB", userLocale: null })).toBe(
      "en-US",
    );
  });

  it("other English locales use the documented fallback, not a guess", () => {
    expect(supportedLocaleOf("en-AU")).toBeNull();
    expect(supportedLocaleOf("en-IE")).toBeNull();
    expect(supportedLocaleOf("fr-FR")).toBeNull();
    expect(resolveLocale("personal", { deviceLocale: "en-IE" })).toBe(FALLBACK_LOCALE);
    expect(supportedLocaleOf("en_gb")).toBe("en-GB");
  });

  it("Accept-Language: the first supported tag by quality", () => {
    expect(localeFromAcceptLanguage("fr-FR,en-GB;q=0.8,en-US;q=0.5")).toBe("en-GB");
    expect(localeFromAcceptLanguage("en-US;q=0.4,en-GB;q=0.9")).toBe("en-GB");
    expect(localeFromAcceptLanguage("de-DE")).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });

  it("the organisation hint is read only from a real organisation URL", () => {
    expect(
      organisationIdFromPath("/app/organisations/2d308eec-3ccb-46ad-9462-26326cb91f61/settings"),
    ).toBe("2d308eec-3ccb-46ad-9462-26326cb91f61");
    expect(organisationIdFromPath("/app/account")).toBeNull();
    expect(organisationIdFromPath("/app/organisations/not-a-uuid")).toBeNull();
  });
});

describe("personal display timezone", () => {
  it("accepts IANA zones and rejects anything else", () => {
    for (const zone of ["America/New_York", "Europe/London", "Africa/Lagos", "UTC"]) {
      expect(isValidTimeZone(zone)).toBe(true);
    }
    for (const zone of ["", "Mars/Olympus", "+01:00", "Europe/London; drop", 42, null]) {
      expect(isValidTimeZone(zone)).toBe(false);
    }
  });

  it("device detection falls back to null on an invalid or failing runtime", () => {
    expect(detectDeviceTimeZone(() => "Africa/Lagos")).toBe("Africa/Lagos");
    expect(detectDeviceTimeZone(() => "Etc/Unknown_Zone")).toBeNull();
    expect(detectDeviceTimeZone(() => undefined)).toBeNull();
    expect(
      detectDeviceTimeZone(() => {
        throw new Error("no Intl");
      }),
    ).toBeNull();
  });

  it("automatic follows the device; manual is never overwritten", () => {
    expect(
      shouldSyncDeviceTimeZone({ timezoneMode: "automatic", timezone: null }, "Africa/Lagos"),
    ).toBe(true);
    expect(
      shouldSyncDeviceTimeZone(
        { timezoneMode: "automatic", timezone: "Africa/Lagos" },
        "Europe/London",
      ),
    ).toBe(true);
    expect(
      shouldSyncDeviceTimeZone(
        { timezoneMode: "automatic", timezone: "Europe/London" },
        "Europe/London",
      ),
    ).toBe(false);
    expect(
      shouldSyncDeviceTimeZone({ timezoneMode: "manual", timezone: "Europe/London" }, "Asia/Tokyo"),
    ).toBe(false);
    expect(shouldSyncDeviceTimeZone({ timezoneMode: "automatic", timezone: null }, null)).toBe(
      false,
    );
  });

  it("an unknown or invalid saved zone displays in UTC", () => {
    expect(resolveDisplayTimeZone({ timezoneMode: "automatic", timezone: null })).toBe("UTC");
    expect(resolveDisplayTimeZone({ timezoneMode: "manual", timezone: "Europe/London" })).toBe(
      "Europe/London",
    );
  });

  it("DST: the display zone formats each instant with its own offset", () => {
    const format = (iso: string) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(iso));
    expect(format("2026-03-28T12:00:00Z")).toBe("12:00"); // GMT
    expect(format("2026-03-30T12:00:00Z")).toBe("13:00"); // BST
  });
});

describe("operational time is never the device's", () => {
  // A 7:00 AM New York shift. The worker's phone is in London; shiftPeriod has
  // no device-timezone input at all, only the shift's own zone.
  const shift = {
    startAt: "2026-10-12T11:00:00Z", // 07:00 America/New_York (EDT)
    endAt: "2026-10-12T19:00:00Z",
    timezone: "America/New_York",
  };

  it("Today / Upcoming / Past follow the facility's calendar", () => {
    // 01:30 in London on 12 Oct is still 11 Oct (21:30) in New York ⇒ Upcoming, not Today.
    expect(shiftPeriod(shift, new Date("2026-10-12T00:30:00Z"))).toBe("upcoming");
    expect(shiftPeriod(shift, new Date("2026-10-12T05:00:00Z"))).toBe("today");
    expect(shiftPeriod(shift, new Date("2026-10-13T05:00:00Z"))).toBe("past");
  });

  it("the shift's local start stays 7:00 AM New York time", () => {
    const local = new Intl.DateTimeFormat("en-US", {
      timeZone: shift.timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(shift.startAt));
    expect(local).toBe("7:00 AM");
  });
});

describe("facility photo pre-check (P0-E9-3F root cause)", () => {
  const photo = (name: string, type: string, size = 400_000) => ({ name, type, size });

  it("accepts what phone pickers really report", () => {
    expect(checkFacilityImageFile(photo("front.jpg", "image/jpeg"))).toMatchObject({
      ok: true,
      mimeType: "image/jpeg",
    });
    expect(checkFacilityImageFile(photo("front.png", "image/png"))).toMatchObject({
      ok: true,
      mimeType: "image/png",
    });
    expect(checkFacilityImageFile(photo("front.jpg", "image/jpg"))).toMatchObject({
      ok: true,
      mimeType: "image/jpeg",
    });
    expect(checkFacilityImageFile(photo("front.jpg", ""))).toMatchObject({
      ok: true,
      mimeType: "image/jpeg",
    });
    expect(checkFacilityImageFile(photo("1000012345", "image/jpeg"))).toMatchObject({ ok: true });
    expect(checkFacilityImageFile(photo("IMG_0412.HEIC", "image/jpeg"))).toMatchObject({
      ok: true,
    });
    expect(checkFacilityImageFile(photo("front.png", "application/octet-stream"))).toMatchObject({
      ok: true,
      mimeType: "image/png",
    });
  });

  it("refuses other types, contradictions and empty files", () => {
    expect(checkFacilityImageFile(photo("plan.pdf", "application/pdf"))).toEqual({
      ok: false,
      reason: "type",
    });
    expect(checkFacilityImageFile(photo("front.gif", "image/gif"))).toEqual({
      ok: false,
      reason: "type",
    });
    expect(checkFacilityImageFile(photo("front.png", "image/jpeg"))).toEqual({
      ok: false,
      reason: "type",
    });
    expect(checkFacilityImageFile(photo("unknown", ""))).toEqual({ ok: false, reason: "type" });
    expect(checkFacilityImageFile(photo("front.jpg", "image/jpeg", 0))).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("a camera photo over 2 MB is resized, not refused", () => {
    expect(checkFacilityImageFile(photo("IMG_0412.jpg", "image/jpeg", 3_400_000))).toEqual({
      ok: true,
      mimeType: "image/jpeg",
      needsResize: true,
    });
    expect(
      checkFacilityImageFile(photo("small.jpg", "image/jpeg", MAX_FACILITY_IMAGE_BYTES)),
    ).toMatchObject({
      needsResize: false,
    });
    expect(fitWithin(4032, 3024, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 }); // never enlarged
  });
});
