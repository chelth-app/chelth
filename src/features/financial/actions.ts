"use server";

/**
 * Payroll preparation and invoice drafting Server Actions. They carry
 * identifiers only; the database authorises (capability + AAL2 for approve
 * and export), copies amounts from immutable priced lines, generates export
 * files, computes checksums and audits every step.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { type ActionState, runAction } from "@/lib/actions/run-action";
import { requireAuthIdentity } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataToObject, parseInput } from "@/lib/validation";

import {
  cancelPayrollBatchSchema,
  createInvoiceDraftSchema,
  createPayrollBatchSchema,
  financialSettingsSchema,
  invoiceDraftActionSchema,
  payrollBatchActionSchema,
  voidInvoiceDraftSchema,
} from "./schemas";

const payrollPath = (organisationId: string) => `/app/organisations/${organisationId}/payroll`;
const invoicesPath = (organisationId: string) => `/app/organisations/${organisationId}/invoices`;

export async function saveFinancialSettingsAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("financial.saveSettings", async () => {
    const input = parseInput(financialSettingsSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_agency_financial_settings", {
      p_organisation_id: input.organisationId,
      p_payroll_period_type: input.payrollPeriodType,
      p_payroll_anchor_date: input.payrollAnchorDate,
      p_payroll_reference_prefix: input.payrollReferencePrefix,
      p_invoice_reference_prefix: input.invoiceReferencePrefix,
    });
    if (error) throw error;
    revalidatePath(payrollPath(input.organisationId));
    return null;
  });
}

// -----------------------------------------------------------------------------
// Payroll
// -----------------------------------------------------------------------------

export async function createPayrollBatchAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let target: string | null = null;
  const result = await runAction("financial.createPayrollBatch", async () => {
    const input = parseInput(createPayrollBatchSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_payroll_batch", {
      p_organisation_id: input.organisationId,
      p_period_start: input.periodStart,
      p_currency: input.currency,
    });
    if (error) throw error;
    revalidatePath(payrollPath(input.organisationId));
    target = `${payrollPath(input.organisationId)}/${data}`;
    return null;
  });
  if (result.ok && target) redirect(target);
  return result;
}

const PAYROLL_STEP_RPC = {
  review: "review_payroll_batch",
  approve: "approve_payroll_batch",
  lock: "lock_payroll_batch",
  export: "create_payroll_export",
} as const;

export async function payrollBatchStepAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("financial.payrollBatchStep", async () => {
    const input = parseInput(payrollBatchActionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc(PAYROLL_STEP_RPC[input.step], {
      p_batch_id: input.batchId,
    });
    if (error) throw error;
    revalidatePath(payrollPath(input.organisationId));
    revalidatePath(`${payrollPath(input.organisationId)}/${input.batchId}`);
    return null;
  });
}

export async function cancelPayrollBatchAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("financial.cancelPayrollBatch", async () => {
    const input = parseInput(cancelPayrollBatchSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("cancel_payroll_batch", {
      p_batch_id: input.batchId,
      p_reason: input.reason,
    });
    if (error) throw error;
    revalidatePath(payrollPath(input.organisationId));
    revalidatePath(`${payrollPath(input.organisationId)}/${input.batchId}`);
    return null;
  });
}

// -----------------------------------------------------------------------------
// Invoice drafts
// -----------------------------------------------------------------------------

export async function createInvoiceDraftAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let target: string | null = null;
  const result = await runAction("financial.createInvoiceDraft", async () => {
    const input = parseInput(createInvoiceDraftSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_invoice_draft", {
      p_organisation_id: input.organisationId,
      p_relationship_id: input.relationshipId,
      p_period_start: input.periodStart,
      p_currency: input.currency,
    });
    if (error) throw error;
    revalidatePath(invoicesPath(input.organisationId));
    target = `${invoicesPath(input.organisationId)}/${data}`;
    return null;
  });
  if (result.ok && target) redirect(target);
  return result;
}

export async function invoiceDraftStepAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("financial.invoiceDraftStep", async () => {
    const input = parseInput(invoiceDraftActionSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } =
      input.step === "export_csv" || input.step === "export_pdf"
        ? await supabase.rpc("create_invoice_export", {
            p_draft_id: input.draftId,
            p_format: input.step === "export_csv" ? "csv" : "pdf",
          })
        : await supabase.rpc(
            input.step === "review"
              ? "review_invoice_draft"
              : input.step === "approve"
                ? "approve_invoice_draft"
                : "lock_invoice_draft",
            { p_draft_id: input.draftId },
          );
    if (error) throw error;
    revalidatePath(invoicesPath(input.organisationId));
    revalidatePath(`${invoicesPath(input.organisationId)}/${input.draftId}`);
    return null;
  });
}

export async function voidInvoiceDraftAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("financial.voidInvoiceDraft", async () => {
    const input = parseInput(voidInvoiceDraftSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("void_invoice_draft", {
      p_draft_id: input.draftId,
      p_reason: input.reason,
    });
    if (error) throw error;
    revalidatePath(invoicesPath(input.organisationId));
    revalidatePath(`${invoicesPath(input.organisationId)}/${input.draftId}`);
    return null;
  });
}
