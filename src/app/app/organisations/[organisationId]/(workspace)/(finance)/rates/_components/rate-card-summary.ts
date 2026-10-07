import type { StatusTone } from "@/components/ui/status-chip";
import type { RateCardRow, RateVersionRow } from "@/features/pricing";
import { SHIFT_CLASSIFICATION_LABELS, type VersionPhase, versionPhase } from "@/lib/domain/pricing";

/*
 * Presentation summary of a loaded rate card. Nothing here decides pricing:
 * the database engine resolves rates. These helpers only describe a card the
 * way the engine treats it (a card with no version in force on a date blocks
 * matching work; there is no fallback to a broader card).
 */

/** Today's standing of the card as a whole. */
export type CardState = "active" | "upcoming" | "draft" | "inactive";

export const CARD_STATE_LABELS: Record<CardState, string> = {
  active: "Active",
  upcoming: "Starts later",
  draft: "Draft",
  inactive: "Not in force",
};

export const CARD_STATE_TONE: Record<CardState, StatusTone> = {
  active: "success",
  upcoming: "info",
  draft: "warning",
  inactive: "danger",
};

export const PHASE_TONE: Record<VersionPhase, StatusTone> = {
  draft: "warning",
  discarded: "neutral",
  upcoming: "info",
  current: "success",
  superseded: "neutral",
  ended: "neutral",
};

/** Quick filters (all over the loaded cards). */
export const CARD_FILTERS = ["active", "attention", "draft", "upcoming"] as const;
export type CardFilter = (typeof CARD_FILTERS)[number];

export const CARD_FILTER_LABELS: Record<CardFilter, string> = {
  active: "Active (rate in force)",
  attention: "Needs attention (no rate in force)",
  draft: "With a draft version",
  upcoming: "With an upcoming version",
};

export type RateCardSummary = {
  card: RateCardRow;
  scope: string;
  facility: string;
  shiftType: string;
  phases: VersionPhase[];
  state: CardState;
  /** The version the row shows: in force, else the next upcoming, else the newest draft. */
  shown: RateVersionRow | null;
  /** Engine precedence tier of this card's scope (1 = most specific). */
  tier: 1 | 2 | 3 | 4;
};

export function summarise(card: RateCardRow, today: string): RateCardSummary {
  const phased = card.versions.map((version) => ({ version, phase: versionPhase(version, today) }));
  const phases = phased.map((item) => item.phase);
  const pick = (phase: VersionPhase) => phased.filter((item) => item.phase === phase);
  const current = pick("current")[0]?.version;
  const upcoming = pick("upcoming")
    .map((item) => item.version)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
  const draft = pick("draft")
    .map((item) => item.version)
    .sort((a, b) => b.version - a.version)[0];
  const state: CardState = current
    ? "active"
    : upcoming
      ? "upcoming"
      : draft
        ? "draft"
        : "inactive";
  const facility = card.facilityName ?? "All facilities";
  const shiftType = card.classification
    ? SHIFT_CLASSIFICATION_LABELS[card.classification]
    : "Any shift type";
  return {
    card,
    scope: `${facility} · ${card.disciplineName} · ${shiftType}`,
    facility,
    shiftType,
    phases,
    state,
    shown:
      current ??
      upcoming ??
      draft ??
      [...card.versions].sort((a, b) => b.version - a.version)[0] ??
      null,
    tier: card.relationshipId ? (card.classification ? 1 : 2) : card.classification ? 3 : 4,
  };
}

export function matchesFilter(summary: RateCardSummary, filter: CardFilter): boolean {
  switch (filter) {
    case "active":
      return summary.state === "active";
    case "attention":
      return summary.state !== "active";
    case "draft":
      return summary.phases.includes("draft");
    case "upcoming":
      return summary.phases.includes("upcoming");
  }
}

const dateFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium" });

/** Calendar date (UTC so the stored date never shifts). */
export function rateDay(value: string | null, empty = "No end"): string {
  return value ? dateFormat.format(new Date(`${value}T00:00:00Z`)) : empty;
}

/** Adds whole days to an ISO date (yyyy-mm-dd). */
export function addIsoDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
