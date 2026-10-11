/**
 * Pricing vocabulary and money presentation (P0-E7-S1).
 *
 * Money is integer MINOR units end to end. The database performs every
 * calculation (internal.price_timesheet_revision); this module only parses
 * user-typed decimal amounts into minor units exactly (string arithmetic, never
 * floating point) and formats minor units with the currency's own rules.
 */
import { Constants, type Database } from "@/types/database.types";

type Enums = Database["public"]["Enums"];

export type ShiftClassification = Enums["shift_classification"];
export type RateVersionStatus = Enums["rate_version_status"];
export type RoundingMode = Enums["rounding_mode"];
export type OvertimeMode = Enums["overtime_mode"];
export type PricingSide = Enums["pricing_side"];

export const SHIFT_CLASSIFICATIONS = Constants.public.Enums.shift_classification;
export const PRICING_CALCULATION_VERSION = 1;

/** Currencies seeded by migration (ISO 4217). All use two minor-unit digits. */
export const SUPPORTED_CURRENCIES = ["USD", "CAD", "GBP", "EUR", "AUD", "NZD"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
export const CURRENCY_MINOR_DIGITS = 2;

/**
 * Shift classification labels (P0-E9-3F): the stored key `regular` is the
 * standard daytime shift and is shown as "Day Shift". The key itself is
 * unchanged (rates, shifts and priced lines keep `regular`). Evening, night and
 * weekend are separate categories, never covered by Day Shift.
 *
 * Not to be confused with "regular time" in payroll, which means non-overtime
 * minutes (pay_regular_minutes) and keeps its wording.
 */
export const SHIFT_CLASSIFICATION_LABELS: Record<ShiftClassification, string> = {
  regular: "Day Shift",
  evening: "Evening",
  night: "Night",
  weekend: "Weekend",
};

/** Standalone phrase for a shift's classification ("Day Shift", "Night shift"). */
export function shiftClassificationPhrase(classification: ShiftClassification): string {
  return classification === "regular"
    ? SHIFT_CLASSIFICATION_LABELS.regular
    : `${SHIFT_CLASSIFICATION_LABELS[classification]} shift`;
}

export const RATE_PRECEDENCE_LABELS: Record<number, string> = {
  1: "Facility + discipline + classification",
  2: "Facility + discipline",
  3: "All facilities + discipline + classification",
  4: "All facilities + discipline",
};

export const PRICING_ISSUE_LABELS: Record<string, string> = {
  RATE_NOT_CONFIGURED: "No active rate for this work",
  RATE_AMBIGUOUS: "More than one rate matches",
  RATE_CURRENCY_MISMATCH: "Rates use different currencies",
};

export function pricingIssueLabel(code: string): string {
  return PRICING_ISSUE_LABELS[code] ?? code;
}

/**
 * Parses a typed amount ("42.5", "42.50", "1,250.00") into integer minor units.
 * Exact: digits are concatenated, never multiplied as floats. Returns null for
 * anything that is not a plain non-negative decimal with at most `digits`
 * fractional digits.
 */
export function parseMajorToMinor(input: string, digits = CURRENCY_MINOR_DIGITS): number | null {
  const normalised = input.trim().replaceAll(",", "");
  const pattern = new RegExp(`^(\\d{1,9})(?:\\.(\\d{1,${digits}}))?$`);
  const match = pattern.exec(normalised);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(digits, "0");
  const minor = Number(`${whole}${fraction}`);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units → an exact decimal string ("34000" → "340.00"). */
export function minorToDecimalString(
  minor: number | bigint,
  digits = CURRENCY_MINOR_DIGITS,
): string {
  const value = BigInt(minor);
  const negative = value < 0n;
  const absolute = (negative ? -value : value).toString().padStart(digits + 1, "0");
  const whole = absolute.slice(0, absolute.length - digits);
  const fraction = absolute.slice(absolute.length - digits);
  return `${negative ? "-" : ""}${whole}${digits > 0 ? `.${fraction}` : ""}`;
}

/** Currency-aware formatting of minor units (exact: formats the decimal string). */
export function formatMoney(minor: number | bigint, currency: string): string {
  const decimal = minorToDecimalString(minor) as Intl.StringNumericLiteral;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: CURRENCY_MINOR_DIGITS,
    maximumFractionDigits: CURRENCY_MINOR_DIGITS,
  }).format(decimal);
}

export function formatHourlyRate(minor: number | bigint, currency: string): string {
  return `${formatMoney(minor, currency)}/h`;
}

/** Margin is derived for display only; it is never stored. */
export function marginMinor(billMinor: number, payMinor: number): number {
  return billMinor - payMinor;
}

export type VersionPhase = "draft" | "discarded" | "upcoming" | "current" | "superseded" | "ended";

export const VERSION_PHASE_LABELS: Record<VersionPhase, string> = {
  draft: "Draft",
  discarded: "Discarded",
  upcoming: "Upcoming",
  current: "Current",
  superseded: "Superseded",
  ended: "Ended",
};

/**
 * Where a version sits relative to a date (ISO yyyy-mm-dd). `periodEnd` is the
 * last day the version applies (null = open-ended), as computed by the database.
 */
export function versionPhase(
  version: {
    status: RateVersionStatus;
    effectiveFrom: string;
    periodEnd: string | null;
    supersededFrom: string | null;
  },
  today: string,
): VersionPhase {
  if (version.status === "draft") return "draft";
  if (version.status === "discarded") return "discarded";
  if (version.effectiveFrom > today) return "upcoming";
  if (version.periodEnd === null || version.periodEnd >= today) return "current";
  return version.supersededFrom ? "superseded" : "ended";
}

export const ROUNDING_INCREMENTS = [5, 6, 10, 15] as const;

/**
 * Time calculation method (P0-E9-3F). Mode `none` prices the exact worked
 * minutes; `nearest` rounds each entry half-up to the increment first.
 */
export function describeRounding(mode: RoundingMode, increment: number | null): string {
  return mode === "none" || increment === null ? "Exact minutes" : `Nearest ${increment} minutes`;
}

export function describeOvertime(
  numerator: number | null,
  denominator: number | null,
  thresholdMinutes?: number | null,
): string {
  if (numerator === null || denominator === null) return "No overtime";
  const multiplier = (numerator / denominator).toFixed(2).replace(/\.?0+$/, "");
  return thresholdMinutes
    ? `${multiplier}× after ${thresholdMinutes / 60} h per week`
    : `${multiplier}× overtime`;
}

/**
 * Time calculation method in effect on `date`: the latest ACTIVE rounding
 * policy that starts on or before it (mirrors internal.rounding_policy_for).
 * No policy ⇒ exact minutes (Chelth's default; existing agencies unchanged).
 */
export function roundingInEffect<
  T extends {
    status: string;
    effectiveFrom: string;
    roundingMode?: RoundingMode;
    increment?: number | null;
  },
>(policies: readonly T[], date: string): T | null {
  return (
    policies
      .filter((policy) => policy.status === "active" && policy.effectiveFrom <= date)
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0] ?? null
  );
}

/** Minutes priced under a method (calculation version 1, integers only). */
export function pricedMinutes(
  rawMinutes: number,
  mode: RoundingMode,
  increment: number | null,
): number {
  if (mode !== "nearest" || !increment) return rawMinutes;
  // round-half-up(raw / N) × N, as (2a + b) div 2b
  return Math.floor((2 * rawMinutes + increment) / (2 * increment)) * increment;
}

/**
 * Amount in minor units for minutes at an hourly rate (minor units):
 * round-half-up(rate × minutes / 60). BigInt: exact for any realistic input;
 * mirrors the database engine, which remains the only source of stored money.
 */
export function amountForMinutes(rateMinor: number | bigint, minutes: number): bigint {
  const numerator = BigInt(rateMinor) * BigInt(minutes);
  return (2n * numerator + 60n) / 120n;
}

/** "7h 37m" */
export function formatHoursMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}
