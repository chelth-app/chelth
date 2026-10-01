import "server-only";

import type {
  OvertimeMode,
  PricingSide,
  RateVersionStatus,
  RoundingMode,
  ShiftClassification,
} from "@/lib/domain/pricing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Constants, type Json } from "@/types/database.types";

/* Reads run as the signed-in user; RLS and the projections decide visibility. */

export type RateVersionRow = {
  id: string;
  version: number;
  status: RateVersionStatus;
  currency: string;
  payRateMinor: number;
  billRateMinor: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  supersededFrom: string | null;
  periodEnd: string | null;
};

export type RateCardRow = {
  id: string;
  createdAt: string;
  relationshipId: string | null;
  facilityName: string | null;
  disciplineKey: string;
  disciplineName: string;
  classification: ShiftClassification | null;
  versions: RateVersionRow[];
};

function versions(value: Json): RateVersionRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const text = (key: string) => (typeof item[key] === "string" ? (item[key] as string) : null);
    const num = (key: string) => (typeof item[key] === "number" ? (item[key] as number) : 0);
    const status = Constants.public.Enums.rate_version_status.find((s) => s === item.status);
    const id = text("id");
    const from = text("effective_from");
    if (!status || !id || !from) return [];
    return [
      {
        id,
        version: num("version"),
        status,
        currency: text("currency") ?? "USD",
        payRateMinor: num("pay_rate_minor"),
        billRateMinor: num("bill_rate_minor"),
        effectiveFrom: from,
        effectiveTo: text("effective_to"),
        supersededFrom: text("superseded_from"),
        periodEnd: text("period_end"),
      },
    ];
  });
}

export async function listRateCards(
  organisationId: string,
  after?: { createdAt: string; id: string },
): Promise<RateCardRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_rate_cards", {
    p_organisation_id: organisationId,
    ...(after ? { p_after_created_at: after.createdAt, p_after_id: after.id } : {}),
    p_limit: 50,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.rate_card_id,
    createdAt: row.created_at,
    relationshipId: row.relationship_id,
    facilityName: row.facility_name,
    disciplineKey: row.discipline_key,
    disciplineName: row.discipline_name,
    classification: row.classification,
    versions: versions(row.versions),
  }));
}

export type PolicyRow = {
  id: string;
  version: number;
  status: RateVersionStatus;
  effectiveFrom: string;
  side?: PricingSide;
  roundingMode?: RoundingMode;
  increment?: number | null;
  overtimeMode?: OvertimeMode;
  thresholdMinutes?: number | null;
  numerator?: number | null;
  denominator?: number | null;
};

export async function listPricingPolicies(
  organisationId: string,
): Promise<{ rounding: PolicyRow[]; overtime: PolicyRow[] }> {
  const supabase = await createSupabaseServerClient();
  const [rounding, overtime] = await Promise.all([
    supabase
      .from("rounding_policy_versions")
      .select("id, version, status, mode, increment_minutes, effective_from")
      .eq("agency_organisation_id", organisationId)
      .order("effective_from", { ascending: false })
      .limit(50),
    supabase
      .from("overtime_policy_versions")
      .select(
        "id, version, status, side, mode, weekly_threshold_minutes, multiplier_numerator, multiplier_denominator, effective_from",
      )
      .eq("agency_organisation_id", organisationId)
      .order("effective_from", { ascending: false })
      .limit(50),
  ]);
  if (rounding.error) throw rounding.error;
  if (overtime.error) throw overtime.error;
  return {
    rounding: rounding.data.map((row) => ({
      id: row.id,
      version: row.version,
      status: row.status,
      effectiveFrom: row.effective_from,
      roundingMode: row.mode,
      increment: row.increment_minutes,
    })),
    overtime: overtime.data.map((row) => ({
      id: row.id,
      version: row.version,
      status: row.status,
      effectiveFrom: row.effective_from,
      side: row.side,
      overtimeMode: row.mode,
      thresholdMinutes: row.weekly_threshold_minutes,
      numerator: row.multiplier_numerator,
      denominator: row.multiplier_denominator,
    })),
  };
}

export type ScopeOptions = {
  disciplines: { key: string; name: string }[];
  relationships: { id: string; facilityName: string }[];
};

export async function listRateScopeOptions(organisationId: string): Promise<ScopeOptions> {
  const supabase = await createSupabaseServerClient();
  const [disciplines, relationships] = await Promise.all([
    supabase.from("disciplines").select("key, name").eq("is_active", true).order("sort_order"),
    supabase
      .from("agency_facility_relationships")
      .select("id, facility:agency_facilities(name)")
      .eq("agency_organisation_id", organisationId)
      .neq("status", "ended"),
  ]);
  if (disciplines.error) throw disciplines.error;
  if (relationships.error) throw relationships.error;
  return {
    disciplines: disciplines.data,
    relationships: relationships.data
      .map((row) => ({ id: row.id, facilityName: row.facility?.name ?? "Facility" }))
      .sort((a, b) => a.facilityName.localeCompare(b.facilityName)),
  };
}

export type PricingIssue = {
  entryId: string;
  localDate: string;
  code: string;
  disciplineKey: string | null;
  classification: string | null;
};

export type PricingQueueRow = {
  timesheetId: string;
  pricedTimesheetId: string | null;
  workerName: string | null;
  periodStart: string;
  periodEnd: string;
  revision: number;
  currentRevision: number;
  entryCount: number;
  workedMinutes: number;
  facilities: string[];
  issues: PricingIssue[];
  currency: string | null;
  totalPayMinor: number | null;
  totalBillMinor: number | null;
  pricedAt: string | null;
};

function issues(value: Json): PricingIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const text = (key: string) => (typeof item[key] === "string" ? (item[key] as string) : null);
    return [
      {
        entryId: text("entry_id") ?? "",
        localDate: text("local_date") ?? "",
        code: text("code") ?? "",
        disciplineKey: text("discipline_key"),
        classification: text("classification"),
      },
    ];
  });
}

export async function listPricingQueue(
  organisationId: string,
  state: "attention" | "ready" | "priced",
  after?: { period: string; id: string },
): Promise<PricingQueueRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_pricing_queue", {
    p_organisation_id: organisationId,
    p_state: state,
    ...(after ? { p_after_period: after.period, p_after_id: after.id } : {}),
    p_limit: 50,
  });
  if (error) throw error;
  return data.map((row) => ({
    timesheetId: row.timesheet_id,
    pricedTimesheetId: row.priced_timesheet_id,
    workerName: row.worker_name,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    revision: row.revision,
    currentRevision: row.current_revision,
    entryCount: row.entry_count,
    workedMinutes: row.worked_minutes,
    facilities: row.facilities,
    issues: issues(row.issues),
    currency: row.currency,
    totalPayMinor: row.total_pay_minor,
    totalBillMinor: row.total_bill_minor,
    pricedAt: row.priced_at,
  }));
}

export type PricedTimesheet = {
  id: string;
  timesheetId: string;
  organisationId: string;
  workerName: string | null;
  periodStart: string;
  periodEnd: string;
  revision: number;
  currentRevision: number;
  currency: string;
  lineCount: number;
  totalRawMinutes: number;
  totalPricedMinutes: number;
  totalPayOvertimeMinutes: number;
  totalBillOvertimeMinutes: number;
  totalPayMinor: number;
  totalBillMinor: number;
  calculationVersion: number;
  pricedAt: string;
  pricedByName: string | null;
};

export async function getPricedTimesheet(id: string): Promise<PricedTimesheet | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_priced_timesheet", { p_priced_timesheet_id: id });
  if (error) {
    if (error.code === "CHM15") return null;
    throw error;
  }
  const row = data[0];
  return row
    ? {
        id: row.priced_timesheet_id,
        timesheetId: row.timesheet_id,
        organisationId: row.agency_organisation_id,
        workerName: row.worker_name,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        revision: row.timesheet_revision,
        currentRevision: row.current_revision,
        currency: row.currency,
        lineCount: row.line_count,
        totalRawMinutes: row.total_raw_minutes,
        totalPricedMinutes: row.total_priced_minutes,
        totalPayOvertimeMinutes: row.total_pay_overtime_minutes,
        totalBillOvertimeMinutes: row.total_bill_overtime_minutes,
        totalPayMinor: row.total_pay_minor,
        totalBillMinor: row.total_bill_minor,
        calculationVersion: row.calculation_version,
        pricedAt: row.priced_at,
        pricedByName: row.priced_by_name,
      }
    : null;
}

export type PricedLine = {
  lineNumber: number;
  localDate: string;
  facilityName: string;
  disciplineName: string;
  classification: ShiftClassification;
  rawMinutes: number;
  pricedMinutes: number;
  payOvertimeMinutes: number;
  billOvertimeMinutes: number;
  rateVersion: number;
  ratePrecedence: number;
  currency: string;
  payRateMinor: number;
  billRateMinor: number;
  roundingMode: RoundingMode;
  roundingIncrement: number | null;
  payOvertimeNumerator: number | null;
  payOvertimeDenominator: number | null;
  billOvertimeNumerator: number | null;
  billOvertimeDenominator: number | null;
  payAmountMinor: number;
  billAmountMinor: number;
};

export async function listPricedLines(id: string): Promise<PricedLine[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_priced_timesheet_lines", {
    p_priced_timesheet_id: id,
  });
  if (error) throw error;
  return data.map((row) => ({
    lineNumber: row.line_number,
    localDate: row.local_date,
    facilityName: row.facility_name,
    disciplineName: row.discipline_name,
    classification: row.classification,
    rawMinutes: row.raw_minutes,
    pricedMinutes: row.priced_minutes,
    payOvertimeMinutes: row.pay_overtime_minutes,
    billOvertimeMinutes: row.bill_overtime_minutes,
    rateVersion: row.rate_version,
    ratePrecedence: row.rate_precedence,
    currency: row.currency,
    payRateMinor: row.pay_rate_minor,
    billRateMinor: row.bill_rate_minor,
    roundingMode: row.rounding_mode,
    roundingIncrement: row.rounding_increment_minutes,
    payOvertimeNumerator: row.pay_overtime_numerator,
    payOvertimeDenominator: row.pay_overtime_denominator,
    billOvertimeNumerator: row.bill_overtime_numerator,
    billOvertimeDenominator: row.bill_overtime_denominator,
    payAmountMinor: row.pay_amount_minor,
    billAmountMinor: row.bill_amount_minor,
  }));
}
