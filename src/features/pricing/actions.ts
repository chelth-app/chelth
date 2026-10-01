"use server";

/**
 * Rate and pricing Server Actions. Amounts typed by a finance user are parsed
 * to integer minor units exactly; the database validates, versions, audits and
 * performs every calculation. Pricing actions carry ids and the expected
 * revision only — never minutes or amounts.
 */
import { revalidatePath } from "next/cache";

import { type ActionState, runAction } from "@/lib/actions/run-action";
import { requireAuthIdentity } from "@/lib/auth/session";
import { AppError, type ErrorCode } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataToObject, parseInput } from "@/lib/validation";

import {
  newRateSchema,
  newVersionSchema,
  overtimePolicySchema,
  policyStatusSchema,
  priceTimesheetSchema,
  roundingPolicySchema,
  shiftClassificationSchema,
  versionActionSchema,
} from "./schemas";

const ISSUE_ERROR: Record<string, ErrorCode> = {
  RATE_NOT_CONFIGURED: "RATE_NOT_CONFIGURED",
  RATE_AMBIGUOUS: "RATE_AMBIGUOUS",
  RATE_CURRENCY_MISMATCH: "RATE_CURRENCY_MISMATCH",
};

function revalidateRates(organisationId: string) {
  revalidatePath(`/app/organisations/${organisationId}/rates`);
}

export async function createRateAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("pricing.createRate", async () => {
    const input = parseInput(newRateSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const card = await supabase.rpc("create_rate_card", {
      p_organisation_id: input.organisationId,
      p_discipline_key: input.disciplineKey,
      ...(input.relationshipId ? { p_relationship_id: input.relationshipId } : {}),
      ...(input.classification ? { p_classification: input.classification } : {}),
    });
    if (card.error) throw card.error;
    const version = await supabase.rpc("create_rate_version", {
      p_rate_card_id: card.data,
      p_currency: input.currency,
      p_pay_rate_minor: input.payRate,
      p_bill_rate_minor: input.billRate,
      p_effective_from: input.effectiveFrom,
      ...(input.effectiveTo ? { p_effective_to: input.effectiveTo } : {}),
    });
    if (version.error) throw version.error;
    revalidateRates(input.organisationId);
    return null;
  });
}

export async function createVersionAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("pricing.createVersion", async () => {
    const input = parseInput(newVersionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("create_rate_version", {
      p_rate_card_id: input.rateCardId,
      p_currency: input.currency,
      p_pay_rate_minor: input.payRate,
      p_bill_rate_minor: input.billRate,
      p_effective_from: input.effectiveFrom,
      ...(input.effectiveTo ? { p_effective_to: input.effectiveTo } : {}),
    });
    if (error) throw error;
    revalidateRates(input.organisationId);
    return null;
  });
}

export async function activateVersionAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("pricing.activateVersion", async () => {
    const input = parseInput(versionActionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("activate_rate_version", {
      p_version_id: input.versionId,
    });
    if (error) throw error;
    revalidateRates(input.organisationId);
    return null;
  });
}

export async function discardVersionAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("pricing.discardVersion", async () => {
    const input = parseInput(versionActionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("discard_rate_version", { p_version_id: input.versionId });
    if (error) throw error;
    revalidateRates(input.organisationId);
    return null;
  });
}

export async function createRoundingPolicyAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("pricing.createRounding", async () => {
    const input = parseInput(roundingPolicySchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("create_rounding_policy", {
      p_organisation_id: input.organisationId,
      p_mode: input.mode,
      ...(input.mode === "nearest" && input.increment
        ? { p_increment_minutes: input.increment }
        : {}),
      p_effective_from: input.effectiveFrom,
    });
    if (error) throw error;
    revalidateRates(input.organisationId);
    return null;
  });
}

export async function createOvertimePolicyAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("pricing.createOvertime", async () => {
    const input = parseInput(overtimePolicySchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("create_overtime_policy", {
      p_organisation_id: input.organisationId,
      p_side: input.side,
      p_mode: input.mode,
      ...(input.thresholdMinutes ? { p_weekly_threshold_minutes: input.thresholdMinutes } : {}),
      ...(input.numerator ? { p_multiplier_numerator: input.numerator } : {}),
      ...(input.denominator ? { p_multiplier_denominator: input.denominator } : {}),
      p_effective_from: input.effectiveFrom,
    });
    if (error) throw error;
    revalidateRates(input.organisationId);
    return null;
  });
}

export async function setPolicyStatusAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("pricing.setPolicyStatus", async () => {
    const input = parseInput(policyStatusSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_pricing_policy_status", {
      p_policy_id: input.policyId,
      p_status: input.status,
    });
    if (error) throw error;
    revalidateRates(input.organisationId);
    return null;
  });
}

export async function priceTimesheetAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("pricing.price", async () => {
    const input = parseInput(priceTimesheetSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("price_timesheet", {
      p_timesheet_id: input.timesheetId,
      p_expected_revision: input.revision,
    });
    if (error) throw error;
    revalidatePath(`/app/organisations/${input.organisationId}/pricing`, "layout");
    const row = data[0];
    if (!row) throw new AppError("INTERNAL", { internalMessage: "no pricing result" });
    if (row.outcome === "blocked") {
      const first = Array.isArray(row.issues) ? row.issues[0] : null;
      const code =
        first &&
        typeof first === "object" &&
        !Array.isArray(first) &&
        typeof first.code === "string"
          ? first.code
          : "";
      throw new AppError(ISSUE_ERROR[code] ?? "RATE_NOT_CONFIGURED", {
        internalMessage: `pricing blocked: ${code}`,
      });
    }
    return null;
  });
}

export async function setShiftClassificationAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("pricing.setShiftClassification", async () => {
    const input = parseInput(shiftClassificationSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_shift_classification", {
      p_shift_id: input.shiftId,
      p_classification: input.classification,
    });
    if (error) throw error;
    revalidatePath(`/app/organisations/${input.organisationId}/shifts/${input.shiftId}`);
    return null;
  });
}
