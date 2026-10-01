import { createHash } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import {
  INVOICE_ADJUSTMENT_CSV_COLUMNS,
  PAYROLL_ADJUSTMENT_CSV_COLUMNS,
} from "@/lib/domain/financial";

import { uniqueEmail } from "../support/mailpit";
import {
  grantPlatformAdmin,
  ownerQuery,
  signUpVerified,
  slug,
  stepUpToAal2,
  type TestIdentity,
} from "./support/identities";
import { addDays, closedPeriodStart, localInstant, pastWork } from "./support/past-work";
import {
  activateCna,
  blsEvidence,
  createAgency,
  facilityWithRelationship,
  invite,
  isoDay,
  must,
  run,
  workerIdAt,
} from "./support/staffing";

/**
 * Financial adjustments & control hardening (P0-E7-S3) through the real API:
 * post-lock revisions resolved as separate delta-only documents, originals and
 * their exports untouched, the 1 → 2 → 3 chain, concurrency, maker/checker
 * and audited denials. Nothing here pays, invoices or calculates tax.
 */

const CHICAGO = "America/Chicago";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("financial adjustments & controls (P0-E7-S3)", () => {
  let admin: TestIdentity;
  let finance: TestIdentity;
  let finance2: TestIdentity;
  let opsManager: TestIdentity;
  let scheduler: TestIdentity;
  let betaAdmin: TestIdentity;
  let gammaAdmin: TestIdentity;
  let alphaId: string;
  let river: { facilityId: string; locationId: string; relationshipId: string };
  let wendy: { identity: TestIdentity; id: string };
  let sheet: string;
  let cardId: string;
  let batchId: string;
  let draftId: string;
  let originalPayrollExport: { id: string; sha256: string };
  const ps = closedPeriodStart();

  async function revise(revision: number) {
    await run(
      admin.client.rpc("reopen_timesheet", {
        p_timesheet_id: sheet,
        p_reason: "approved_in_error",
      }),
    );
    await run(wendy.identity.client.rpc("submit_timesheet", { p_timesheet_id: sheet }));
    await run(
      admin.client.rpc("approve_timesheet", {
        p_timesheet_id: sheet,
        p_expected_revision: revision,
      }),
    );
    const [priced] = await must(
      finance.client.rpc("price_timesheet", {
        p_timesheet_id: sheet,
        p_expected_revision: revision,
      }),
    );
    expect(priced?.outcome).toBe("priced");
  }

  async function rate(card: string, pay: number, bill: number, from: string) {
    const version = await must(
      finance.client.rpc("create_rate_version", {
        p_rate_card_id: card,
        p_currency: "USD",
        p_pay_rate_minor: pay,
        p_bill_rate_minor: bill,
        p_effective_from: from,
      }),
    );
    await run(finance.client.rpc("activate_rate_version", { p_version_id: version }));
  }

  async function downloadBytes(identity: TestIdentity, exportId: string) {
    const [row] = await must(
      identity.client.rpc("download_financial_export", { p_export_id: exportId }),
    );
    expect(row?.denied_reason).toBeNull();
    return { bytes: Buffer.from(row?.content_base64 ?? "", "base64"), sha256: row?.sha256 ?? "" };
  }

  beforeAll(async () => {
    [admin, betaAdmin] = await Promise.all([
      signUpVerified("adj-alpha"),
      signUpVerified("adj-beta"),
    ]);
    alphaId = await createAgency(admin, "Alpha Adjustment Staffing");
    await createAgency(betaAdmin, "Beta Adjustment Staffing");
    await Promise.all([stepUpToAal2(admin), stepUpToAal2(betaAdmin)]);
    scheduler = await invite(admin.client, alphaId, "agency.scheduler", uniqueEmail("adj-sched"));
    finance = await invite(admin.client, alphaId, "agency.finance", uniqueEmail("adj-fin"));
    finance2 = await invite(admin.client, alphaId, "agency.finance", uniqueEmail("adj-fin2"));
    opsManager = await invite(
      admin.client,
      alphaId,
      "agency.operations_manager",
      uniqueEmail("adj-ops"),
    );
    await Promise.all([stepUpToAal2(finance), stepUpToAal2(finance2), stepUpToAal2(opsManager)]);
    await run(
      admin.client.rpc("create_credential_requirement", {
        p_effective_from: isoDay(-30),
        p_agency_organisation_id: alphaId,
        p_credential_type_key: "bls_certification",
      }),
    );
    const identity = await invite(
      admin.client,
      alphaId,
      "agency.healthcare_worker",
      uniqueEmail("adj-wendy"),
    );
    const workerId = await workerIdAt(identity, alphaId);
    await activateCna(admin.client, workerId);
    await blsEvidence(identity, 400, [{ client: admin.client, organisationId: alphaId }]);
    wendy = { identity, id: workerId };
    river = await facilityWithRelationship(admin.client, alphaId, "Riverside", CHICAGO);

    const operator = await signUpVerified("adj-operator");
    await grantPlatformAdmin(operator.userId);
    await stepUpToAal2(operator);
    const email = uniqueEmail("adj-gamma");
    const created = await must(
      operator.client.rpc("platform_create_organisation", {
        p_type: "facility",
        p_name: "Gamma Health Adjustments",
        p_slug: slug("gamma-adj"),
        p_owner_email: email,
      }),
    );
    gammaAdmin = await signUpVerified("adj-gamma", email);
    await run(
      gammaAdmin.client.rpc("accept_organisation_invite", {
        p_token: created[0]?.invite_token ?? "",
      }),
    );

    // Revision 1 at $42.50 / $58.00: 480 + 453 minutes.
    cardId = await must(
      finance.client.rpc("create_rate_card", {
        p_organisation_id: alphaId,
        p_discipline_key: "cna",
        p_relationship_id: river.relationshipId,
      }),
    );
    await rate(cardId, 4250, 5800, addDays(ps, -30));
    let assignmentId = "";
    for (const [day, end] of [
      [1, "17:00"],
      [2, "16:33"],
    ] as const) {
      const date = addDays(ps, day);
      assignmentId = (
        await pastWork({
          scheduler,
          organisationId: alphaId,
          facilityId: river.facilityId,
          locationId: river.locationId,
          workerId: wendy.id,
          workerProfileId: wendy.identity.userId,
          startAt: localInstant(date, "09:00", CHICAGO),
          endAt: localInstant(date, "17:00", CHICAGO),
          events: [
            { type: "clock_in", at: localInstant(date, "09:00", CHICAGO) },
            { type: "clock_out", at: localInstant(date, end, CHICAGO) },
          ],
        })
      ).assignmentId;
    }
    const [entry] = await must(
      admin.client
        .from("timesheet_entries")
        .select("timesheet_id")
        .eq("assignment_id", assignmentId),
    );
    sheet = entry?.timesheet_id ?? "";
    await run(wendy.identity.client.rpc("submit_timesheet", { p_timesheet_id: sheet }));
    await run(
      admin.client.rpc("approve_timesheet", { p_timesheet_id: sheet, p_expected_revision: 1 }),
    );
    await must(
      finance.client.rpc("price_timesheet", { p_timesheet_id: sheet, p_expected_revision: 1 }),
    );

    // Original documents, locked and exported.
    batchId = await must(
      finance.client.rpc("create_payroll_batch", {
        p_organisation_id: alphaId,
        p_period_start: ps,
        p_currency: "USD",
      }),
    );
    await run(finance.client.rpc("review_payroll_batch", { p_batch_id: batchId }));
    await must(finance.client.rpc("approve_payroll_batch", { p_batch_id: batchId }));
    await run(finance.client.rpc("lock_payroll_batch", { p_batch_id: batchId }));
    const exportId = await must(
      finance.client.rpc("create_payroll_export", { p_batch_id: batchId }),
    );
    originalPayrollExport = {
      id: exportId,
      sha256: (await downloadBytes(finance, exportId)).sha256,
    };
    draftId = await must(
      finance.client.rpc("create_invoice_draft", {
        p_organisation_id: alphaId,
        p_relationship_id: river.relationshipId,
        p_period_start: ps,
        p_currency: "USD",
      }),
    );
    await run(finance.client.rpc("review_invoice_draft", { p_draft_id: draftId }));
    await must(finance.client.rpc("approve_invoice_draft", { p_draft_id: draftId }));
    await run(finance.client.rpc("lock_invoice_draft", { p_draft_id: draftId }));
    await must(
      finance.client.rpc("create_invoice_export", { p_draft_id: draftId, p_format: "csv" }),
    );
  }, 300_000);

  let adjustment1: string;
  let invoiceAdjustment1: string;
  let adjustment2: string;

  it("a newer priced revision shows as adjustment required, with an exact delta estimate", async () => {
    await rate(cardId, 4400, 6000, addDays(ps, 2));
    await revise(2);
    const [candidate] = await must(
      finance.client.rpc("list_payroll_adjustment_candidates", { p_organisation_id: alphaId }),
    );
    expect(candidate).toEqual(
      expect.objectContaining({
        timesheet_id: sheet,
        state: "required",
        base_revision: 1,
        current_revision: 2,
        changed_lines: 1,
        net_delta_minor: 1132,
        original_batch_id: batchId,
      }),
    );
  });

  it("two finance users preparing the same adjustment at once: exactly one wins", async () => {
    const attempts = await Promise.all(
      [finance, finance2].map((identity) =>
        identity.client.rpc("create_payroll_adjustment", { p_timesheet_id: sheet }),
      ),
    );
    const winners = attempts.filter((attempt) => !attempt.error);
    expect(winners).toHaveLength(1);
    expect(attempts.find((attempt) => attempt.error)?.error?.code).toBe("CHY13");
    adjustment1 = winners[0]?.data ?? "";
    const all = await must(finance.client.from("payroll_adjustments").select("id"));
    expect(all).toHaveLength(1);
    const claims = await must(
      finance.client.from("payroll_adjustment_claims").select("from_revision"),
    );
    expect(claims).toEqual([{ from_revision: 1 }]);
  });

  it("the positive adjustment is exact and the original batch and export are untouched", async () => {
    const [detail] = await must(
      finance.client.rpc("get_payroll_adjustment", { p_adjustment_id: adjustment1 }),
    );
    expect(detail).toEqual(
      expect.objectContaining({
        from_revision: 1,
        to_revision: 2,
        net_delta_minor: 1132,
        total_increase_minor: 1132,
        total_decrease_minor: 0,
        original_batch_id: batchId,
        previous_adjustment_id: null,
      }),
    );
    expect(detail?.reference).toMatch(/^PAY-ADJ-\d{4}-000001$/);
    const lines = await must(
      finance.client.rpc("list_payroll_adjustment_lines", { p_adjustment_id: adjustment1 }),
    );
    expect(
      lines.map((l) => [l.old_pay_amount_minor, l.new_pay_amount_minor, l.delta_pay_amount_minor]),
    ).toEqual([[32088, 33220, 1132]]);
    for (const step of ["review_payroll_adjustment", "lock_payroll_adjustment"] as const) {
      if (step === "lock_payroll_adjustment") {
        const [approved] = await must(
          finance.client.rpc("approve_payroll_adjustment", { p_adjustment_id: adjustment1 }),
        );
        expect(approved?.outcome).toBe("approved"); // maker/checker off: the preparer may approve
      }
      await run(finance.client.rpc(step, { p_adjustment_id: adjustment1 }));
    }
    const exportId = await must(
      finance.client.rpc("create_payroll_adjustment_export", { p_adjustment_id: adjustment1 }),
    );
    const file = await downloadBytes(finance, exportId);
    expect(sha256(file.bytes)).toBe(file.sha256);
    const text = file.bytes.toString("utf8");
    expect(text.split("\r\n")[0]).toBe(PAYROLL_ADJUSTMENT_CSV_COLUMNS.join(","));
    expect(text).toContain(",32088,33220,1132,");

    const [batch] = await must(finance.client.rpc("get_payroll_batch", { p_batch_id: batchId }));
    expect(batch).toEqual(
      expect.objectContaining({
        status: "exported",
        total_pay_minor: 66088,
        attention: "REVISION_RESOLVED",
      }),
    );
    expect((await downloadBytes(finance, originalPayrollExport.id)).sha256).toBe(
      originalPayrollExport.sha256,
    );
    const work = await must(
      finance.client.rpc("list_payroll_work", { p_organisation_id: alphaId }),
    );
    expect(work).toEqual([]);
  });

  it("the invoice adjustment is bill-side only, shown as an additional charge", async () => {
    const attempts = await Promise.all(
      [finance, finance2].map((identity) =>
        identity.client.rpc("create_invoice_adjustment", {
          p_timesheet_id: sheet,
          p_relationship_id: river.relationshipId,
        }),
      ),
    );
    expect(attempts.filter((attempt) => !attempt.error)).toHaveLength(1);
    invoiceAdjustment1 = attempts.find((attempt) => !attempt.error)?.data ?? "";
    const [detail] = await must(
      finance.client.rpc("get_invoice_adjustment", { p_adjustment_id: invoiceAdjustment1 }),
    );
    expect(detail).toEqual(
      expect.objectContaining({
        direction: "additional_charge",
        net_delta_minor: 1510,
        original_draft_id: draftId,
      }),
    );
    const lines = await must(
      finance.client.rpc("list_invoice_adjustment_lines", { p_adjustment_id: invoiceAdjustment1 }),
    );
    for (const line of lines) {
      expect(Object.keys(line).some((key) => key.includes("pay") || key.includes("margin"))).toBe(
        false,
      );
    }
    await run(
      finance.client.rpc("review_invoice_adjustment", { p_adjustment_id: invoiceAdjustment1 }),
    );
    await must(
      finance.client.rpc("approve_invoice_adjustment", { p_adjustment_id: invoiceAdjustment1 }),
    );
    await run(
      finance.client.rpc("lock_invoice_adjustment", { p_adjustment_id: invoiceAdjustment1 }),
    );
    const csv = await must(
      finance.client.rpc("create_invoice_adjustment_export", {
        p_adjustment_id: invoiceAdjustment1,
        p_format: "csv",
      }),
    );
    const text = (await downloadBytes(finance, csv)).bytes.toString("utf8");
    expect(text.split("\r\n")[0]).toBe(INVOICE_ADJUSTMENT_CSV_COLUMNS.join(","));
    expect(text).toContain('"additional_charge"');
    expect(text).not.toMatch(/4250|4400|32088|33220/);
    const [draft] = await must(finance.client.rpc("get_invoice_draft", { p_draft_id: draftId }));
    expect(draft).toEqual(expect.objectContaining({ status: "exported", total_bill_minor: 90190 }));
  });

  it("maker/checker: the preparer of revision 3's adjustment cannot approve it; a second person can", async () => {
    await run(
      finance.client.rpc("set_financial_maker_checker", {
        p_organisation_id: alphaId,
        p_required: true,
      }),
    );
    // A more specific card ($40.00 / $55.00 for regular shifts) lowers revision 3.
    const tierOne = await must(
      finance.client.rpc("create_rate_card", {
        p_organisation_id: alphaId,
        p_discipline_key: "cna",
        p_relationship_id: river.relationshipId,
        p_classification: "regular",
      }),
    );
    await rate(tierOne, 4000, 5500, addDays(ps, -30));
    await revise(3);
    adjustment2 = await must(
      finance.client.rpc("create_payroll_adjustment", { p_timesheet_id: sheet }),
    );
    const [detail] = await must(
      finance.client.rpc("get_payroll_adjustment", { p_adjustment_id: adjustment2 }),
    );
    expect(detail).toEqual(
      expect.objectContaining({
        from_revision: 2,
        to_revision: 3,
        previous_adjustment_id: adjustment1,
        original_batch_id: batchId,
        net_delta_minor: -5020,
        total_decrease_minor: 5020,
      }),
    );
    await run(finance.client.rpc("review_payroll_adjustment", { p_adjustment_id: adjustment2 }));
    const [self] = await must(
      finance.client.rpc("approve_payroll_adjustment", { p_adjustment_id: adjustment2 }),
    );
    expect(self).toEqual({ outcome: "denied", reason_code: "MAKER_CHECKER" });
    const [ops] = await must(
      opsManager.client.rpc("approve_payroll_adjustment", { p_adjustment_id: adjustment2 }),
    );
    expect(ops?.reason_code).toBe("NOT_PERMITTED");
    const [other] = await must(
      finance2.client.rpc("approve_payroll_adjustment", { p_adjustment_id: adjustment2 }),
    );
    expect(other?.outcome).toBe("approved");
    const denials = await must(
      admin.client
        .from("audit_events")
        .select("action, metadata")
        .eq("action", "financial.action_denied")
        .eq("target_id", adjustment2),
    );
    expect(denials.map((row) => row.metadata).sort()).toEqual([
      { attempted_action: "payroll.adjustment_approve", reason_code: "MAKER_CHECKER" },
      { attempted_action: "payroll.adjustment_approve", reason_code: "NOT_PERMITTED" },
    ]);
  });

  it("maker/checker off again restores the original workflow", async () => {
    await run(
      finance.client.rpc("set_financial_maker_checker", {
        p_organisation_id: alphaId,
        p_required: false,
      }),
    );
    const credit = await must(
      finance.client.rpc("create_invoice_adjustment", {
        p_timesheet_id: sheet,
        p_relationship_id: river.relationshipId,
      }),
    );
    await run(finance.client.rpc("review_invoice_adjustment", { p_adjustment_id: credit }));
    const [own] = await must(
      finance.client.rpc("approve_invoice_adjustment", { p_adjustment_id: credit }),
    );
    expect(own?.outcome).toBe("approved");
    const [detail] = await must(
      finance.client.rpc("get_invoice_adjustment", { p_adjustment_id: credit }),
    );
    expect(detail).toEqual(
      expect.objectContaining({
        direction: "credit",
        net_delta_minor: -6175,
        previous_adjustment_id: invoiceAdjustment1,
      }),
    );
  });

  it("another agency, a worker and a facility have no path; denials are audited safely", async () => {
    expect(
      (await betaAdmin.client.rpc("get_payroll_adjustment", { p_adjustment_id: adjustment1 })).error
        ?.code,
    ).toBe("CHY19");
    expect(
      (await betaAdmin.client.rpc("create_payroll_adjustment", { p_timesheet_id: sheet })).error
        ?.code,
    ).toBe("CHY19");
    expect((await betaAdmin.client.from("payroll_adjustments").select("id")).data).toEqual([]);
    expect(
      (await wendy.identity.client.from("payroll_adjustment_lines").select("id")).data,
    ).toEqual([]);
    expect((await gammaAdmin.client.from("invoice_adjustments").select("id")).data).toEqual([]);
    expect(
      (await scheduler.client.rpc("create_payroll_adjustment", { p_timesheet_id: sheet })).error
        ?.code,
    ).toBe("CHY19");

    const [exp] = await must(
      finance.client.rpc("list_financial_exports", {
        p_source_type: "payroll_adjustment",
        p_source_id: adjustment1,
      }),
    );
    const id = exp?.financial_export_id ?? "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [row] = await must(
        betaAdmin.client.rpc("download_financial_export", { p_export_id: id }),
      );
      expect(row).toEqual(
        expect.objectContaining({ denied_reason: "NOT_FOUND", content_base64: null }),
      );
    }
    const audited = await ownerQuery(
      (sql) => sql<{ organisation_id: string | null; metadata: Record<string, string> }[]>`
        select organisation_id, metadata from public.audit_events
        where action = 'financial.action_denied' and target_id = ${id}::uuid`,
    );
    expect(audited).toEqual([
      {
        organisation_id: null,
        metadata: { attempted_action: "financial.export_download", reason_code: "NOT_FOUND" },
      },
    ]);
  });
});
