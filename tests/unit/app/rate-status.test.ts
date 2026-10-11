import { describe, expect, it } from "vitest";

import {
  CARD_STATE_LABELS,
  rateStatusCard,
  summarise,
} from "@/app/app/organisations/[organisationId]/(workspace)/(finance)/rates/_components/rate-card-summary";
import type { RateCardRow, RateVersionRow } from "@/features/pricing";
import { RATE_PRECEDENCE_LABELS, VERSION_PHASE_LABELS } from "@/lib/domain/pricing";

/*
 * P0-E9-3H: the Rate Details Overview status is derived from the versions the
 * way the engine treats them (presentation only; activation is the existing
 * action and the database decides).
 */

const TODAY = "2026-10-11";

function version(overrides: Partial<RateVersionRow>): RateVersionRow {
  return {
    id: `v-${overrides.version ?? 1}`,
    version: 1,
    status: "active",
    currency: "USD",
    payRateMinor: 3000,
    billRateMinor: 4200,
    effectiveFrom: "2026-09-01",
    effectiveTo: null,
    supersededFrom: null,
    periodEnd: null,
    ...overrides,
  };
}

function card(versions: RateVersionRow[]): RateCardRow {
  return {
    id: "card-1",
    createdAt: "2026-09-01T00:00:00Z",
    relationshipId: "rel-1",
    facilityName: "Riverside Clinic",
    disciplineKey: "cna",
    disciplineName: "Certified Nursing Assistant (CNA)",
    classification: "regular",
    versions,
  };
}

const status = (versions: RateVersionRow[]) =>
  rateStatusCard(summarise(card(versions), TODAY), TODAY);

describe("Rate Details Overview status (P0-E9-3H)", () => {
  it("draft ⇒ Rate not active yet, with the draft to activate", () => {
    const result = status([version({ status: "draft", effectiveFrom: "2026-10-01" })]);
    expect(result.kind).toBe("draft");
    expect(result.title).toBe("Rate not active yet");
    expect(result.body).toBe(
      "This rate is still a draft. Activate it before Chelth can use it for pricing.",
    );
    expect(result.activate?.id).toBe("v-1");
    // The old, misleading primary explanation is gone.
    expect(`${result.title} ${result.body}`).not.toContain("No rate in force today");
  });

  it("active ⇒ Rate active, no warning, no activation", () => {
    const result = status([version({})]);
    expect(result).toMatchObject({ kind: "active", title: "Rate active", activate: null });
    expect(result.body).toBe(
      "This rate is currently available for matching shifts and timesheets.",
    );
  });

  it("active with a scheduled change ⇒ the current version remains in force until then", () => {
    const result = status([
      version({ periodEnd: "2026-10-31" }),
      version({ id: "v-2", version: 2, effectiveFrom: "2026-11-01" }),
    ]);
    expect(result.kind).toBe("active");
    expect(result.secondary).toBe(
      "A new version is scheduled to start on Nov 1, 2026. The current version remains in force until then.",
    );
  });

  it("active with a further draft ⇒ a secondary activation for that draft", () => {
    const result = status([version({}), version({ id: "v-2", version: 2, status: "draft" })]);
    expect(result.kind).toBe("active");
    expect(result.pendingDraft?.id).toBe("v-2");
  });

  it("scheduled (activated, future) ⇒ Rate scheduled, never an Activate button", () => {
    const result = status([version({ effectiveFrom: "2026-11-01" })]);
    expect(result).toMatchObject({
      kind: "scheduled",
      title: "Rate scheduled",
      body: "This rate will start on Nov 1, 2026.",
      secondary: "No rate is active for this matching level until Nov 1, 2026.",
      activate: null,
    });
  });

  it("ended ⇒ Rate ended, with its last day", () => {
    const result = status([version({ effectiveTo: "2026-09-30", periodEnd: "2026-09-30" })]);
    expect(result).toMatchObject({
      kind: "ended",
      title: "Rate ended",
      body: "This rate stopped being active on Sep 30, 2026.",
    });
  });

  it("no applicable version ⇒ No active rate, timesheets wait for review", () => {
    const result = status([version({ status: "discarded" })]);
    expect(result).toMatchObject({
      kind: "none",
      title: "No active rate",
      body: "There is no active rate for this matching level on the selected work date.",
      secondary:
        "Timesheets that require this rate will wait for review until an applicable rate is active.",
    });
  });
});

describe("rate vocabulary", () => {
  it("operators see Draft · Active · Scheduled · Ended", () => {
    expect(VERSION_PHASE_LABELS.current).toBe("Active");
    expect(VERSION_PHASE_LABELS.upcoming).toBe("Scheduled");
    expect(CARD_STATE_LABELS.upcoming).toBe("Scheduled");
    expect(CARD_STATE_LABELS.ended).toBe("Ended");
    for (const label of [
      ...Object.values(VERSION_PHASE_LABELS),
      ...Object.values(CARD_STATE_LABELS),
    ]) {
      expect(label).not.toMatch(/in force|live|published/i);
    }
  });

  it("matching levels keep the engine's order and use shift-type wording", () => {
    expect([1, 2, 3, 4].map((tier) => RATE_PRECEDENCE_LABELS[tier])).toEqual([
      "Facility + discipline + shift type",
      "Facility + discipline, any shift type",
      "All facilities + discipline + shift type",
      "All facilities + discipline, any shift type",
    ]);
  });
});
