import type { StatusTone } from "@/components/ui/status-chip";
import type { RateCardRow, RateVersionRow } from "@/features/pricing";
import { SHIFT_CLASSIFICATION_LABELS, type VersionPhase, versionPhase } from "@/lib/domain/pricing";

/*
 * Presentation summary of a loaded rate card. Nothing here decides pricing:
 * the database engine resolves rates. These helpers only describe a card the
 * way the engine treats it (a card with no version in force on a date blocks
 * matching work; there is no fallback to a broader card).
 */

/**
 * Today's standing of the card as a whole. Operator vocabulary (P0-E9-3H):
 * Draft · Active · Scheduled · Ended (and "No active rate" when nothing ever applied).
 */
export type CardState = "active" | "upcoming" | "draft" | "ended" | "inactive";

export const CARD_STATE_LABELS: Record<CardState, string> = {
  active: "Active",
  upcoming: "Scheduled",
  draft: "Draft",
  ended: "Ended",
  inactive: "No active rate",
};

export const CARD_STATE_TONE: Record<CardState, StatusTone> = {
  active: "success",
  upcoming: "info",
  draft: "warning",
  ended: "neutral",
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
  active: "Active",
  attention: "Needs attention (no active rate)",
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
        : phases.some((phase) => phase === "ended" || phase === "superseded")
          ? "ended"
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

/**
 * The Overview status card (P0-E9-3H): what is true today and the next
 * action. Presentation only — activation itself is the existing action, and
 * the database decides whether a version may be activated.
 */
export type RateStatusCard = {
  kind: "draft" | "active" | "scheduled" | "ended" | "none";
  title: string;
  body: string;
  secondary: string | null;
  /** The draft version the primary "Activate rate" action would activate. */
  activate: RateVersionRow | null;
  /** A further draft next to an active / scheduled version (secondary action). */
  pendingDraft: RateVersionRow | null;
};

export function rateStatusCard(summary: RateCardSummary, today: string): RateStatusCard {
  const phased = summary.card.versions.map((version) => ({
    version,
    phase: versionPhase(version, today),
  }));
  const newestDraft =
    phased
      .filter((item) => item.phase === "draft")
      .map((item) => item.version)
      .sort((a, b) => b.version - a.version)[0] ?? null;
  const nextScheduled =
    phased
      .filter((item) => item.phase === "upcoming")
      .map((item) => item.version)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0] ?? null;

  switch (summary.state) {
    case "draft":
      return {
        kind: "draft",
        title: "Rate not active yet",
        body: "This rate is still a draft. Activate it before Chelth can use it for pricing.",
        secondary: null,
        activate: newestDraft,
        pendingDraft: null,
      };
    case "active":
      return {
        kind: "active",
        title: "Rate active",
        body: "This rate is currently available for matching shifts and timesheets.",
        secondary: nextScheduled
          ? `A new version is scheduled to start on ${rateDay(nextScheduled.effectiveFrom)}. The current version remains in force until then.`
          : null,
        activate: null,
        pendingDraft: newestDraft,
      };
    case "upcoming":
      return {
        kind: "scheduled",
        title: "Rate scheduled",
        body: `This rate will start on ${rateDay(nextScheduled?.effectiveFrom ?? null, "a later date")}.`,
        secondary: `No rate is active for this matching level until ${rateDay(nextScheduled?.effectiveFrom ?? null, "then")}.`,
        activate: null,
        pendingDraft: newestDraft,
      };
    case "ended": {
      const lastEnd = phased
        .filter((item) => item.phase === "ended" || item.phase === "superseded")
        .map((item) => item.version.periodEnd ?? item.version.effectiveTo)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1);
      return {
        kind: "ended",
        title: "Rate ended",
        body: `This rate stopped being active on ${rateDay(lastEnd ?? null, "an earlier date")}.`,
        secondary:
          "Timesheets that require this rate will wait for review until an applicable rate is active.",
        activate: null,
        pendingDraft: null,
      };
    }
    case "inactive":
      return {
        kind: "none",
        title: "No active rate",
        body: "There is no active rate for this matching level on the selected work date.",
        secondary:
          "Timesheets that require this rate will wait for review until an applicable rate is active.",
        activate: null,
        pendingDraft: null,
      };
  }
}
