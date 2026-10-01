"use server";

/**
 * Financial adjustment Server Actions (P0-E7-S3). They carry identifiers only:
 * the database derives every delta from immutable priced lines, enforces the
 * revision chain, maker/checker and AAL2, and audits each step (and refusal).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { type ActionState, runAction } from "@/lib/actions/run-action";
import { requireAuthIdentity } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataToObject, parseInput } from "@/lib/validation";

import { assertNotDenied } from "./denials";
import {
  cancelPayrollAdjustmentSchema,
  createInvoiceAdjustmentSchema,
  createPayrollAdjustmentSchema,
  invoiceAdjustmentStepSchema,
  payrollAdjustmentStepSchema,
  voidInvoiceAdjustmentSchema,
} from "./schemas";

const payrollPath = (organisationId: string) => `/app/organisations/${organisationId}/payroll`;
const invoicesPath = (organisationId: string) => `/app/organisations/${organisationId}/invoices`;

export async function createPayrollAdjustmentAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let target: string | null = null;
  const result = await runAction("financial.createPayrollAdjustment", async () => {
    const input = parseInput(createPayrollAdjustmentSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_payroll_adjustment", {
      p_timesheet_id: input.timesheetId,
    });
    if (error) throw error;
    revalidatePath(payrollPath(input.organisationId));
    target = `${payrollPath(input.organisationId)}/adjustments/${data}`;
    return null;
  });
  if (result.ok && target) redirect(target);
  return result;
}

export async function payrollAdjustmentStepAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("financial.payrollAdjustmentStep", async () => {
    const input = parseInput(payrollAdjustmentStepSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const args = { p_adjustment_id: input.adjustmentId };
    if (input.step === "approve") {
      const { data, error } = await supabase.rpc("approve_payroll_adjustment", args);
      if (error) throw error;
      assertNotDenied(data, "ADJUSTMENT_NOT_FOUND");
    } else {
      const { error } = await supabase.rpc(
        input.step === "review"
          ? "review_payroll_adjustment"
          : input.step === "lock"
            ? "lock_payroll_adjustment"
            : "create_payroll_adjustment_export",
        args,
      );
      if (error) throw error;
    }
    revalidatePath(payrollPath(input.organisationId));
    revalidatePath(`${payrollPath(input.organisationId)}/adjustments/${input.adjustmentId}`);
    return null;
  });
}

export async function cancelPayrollAdjustmentAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("financial.cancelPayrollAdjustment", async () => {
    const input = parseInput(cancelPayrollAdjustmentSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("cancel_payroll_adjustment", {
      p_adjustment_id: input.adjustmentId,
      p_reason: input.reason,
    });
    if (error) throw error;
    revalidatePath(payrollPath(input.organisationId));
    revalidatePath(`${payrollPath(input.organisationId)}/adjustments/${input.adjustmentId}`);
    return null;
  });
}

export async function createInvoiceAdjustmentAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let target: string | null = null;
  const result = await runAction("financial.createInvoiceAdjustment", async () => {
    const input = parseInput(createInvoiceAdjustmentSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_invoice_adjustment", {
      p_timesheet_id: input.timesheetId,
      p_relationship_id: input.relationshipId,
    });
    if (error) throw error;
    revalidatePath(invoicesPath(input.organisationId));
    target = `${invoicesPath(input.organisationId)}/adjustments/${data}`;
    return null;
  });
  if (result.ok && target) redirect(target);
  return result;
}

export async function invoiceAdjustmentStepAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("financial.invoiceAdjustmentStep", async () => {
    const input = parseInput(invoiceAdjustmentStepSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const args = { p_adjustment_id: input.adjustmentId };
    if (input.step === "approve") {
      const { data, error } = await supabase.rpc("approve_invoice_adjustment", args);
      if (error) throw error;
      assertNotDenied(data, "ADJUSTMENT_NOT_FOUND");
    } else if (input.step === "export_csv" || input.step === "export_pdf") {
      const { error } = await supabase.rpc("create_invoice_adjustment_export", {
        ...args,
        p_format: input.step === "export_csv" ? "csv" : "pdf",
      });
      if (error) throw error;
    } else {
      const { error } = await supabase.rpc(
        input.step === "review" ? "review_invoice_adjustment" : "lock_invoice_adjustment",
        args,
      );
      if (error) throw error;
    }
    revalidatePath(invoicesPath(input.organisationId));
    revalidatePath(`${invoicesPath(input.organisationId)}/adjustments/${input.adjustmentId}`);
    return null;
  });
}

export async function voidInvoiceAdjustmentAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("financial.voidInvoiceAdjustment", async () => {
    const input = parseInput(voidInvoiceAdjustmentSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("void_invoice_adjustment", {
      p_adjustment_id: input.adjustmentId,
      p_reason: input.reason,
    });
    if (error) throw error;
    revalidatePath(invoicesPath(input.organisationId));
    revalidatePath(`${invoicesPath(input.organisationId)}/adjustments/${input.adjustmentId}`);
    return null;
  });
}
