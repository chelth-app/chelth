import { createHash } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { INVOICE_CSV_COLUMNS, PAYROLL_CSV_COLUMNS } from "@/lib/domain/financial";

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
 * Payroll preparation & invoice drafting (P0-E7-S2) through the real API:
 * concurrent preparation, exact money, deterministic exports and checksums,
 * download authorisation, tenant/worker/facility isolation, and revisions
 * after lock. Nothing here pays, invoices or calculates tax.
 */

const CHICAGO = "America/Chicago";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("payroll preparation & invoice drafting (P0-E7-S2)", () => {
  let admin: TestIdentity;
  let finance: TestIdentity;
  let finance2: TestIdentity;
  let scheduler: TestIdentity;
  let opsManager: TestIdentity;
  let betaAdmin: TestIdentity;
  let gammaAdmin: TestIdentity;
  let alphaId: string;
  let betaId: string;
  let river: { facilityId: string; locationId: string; relationshipId: string };
  const workers: Record<string, { identity: TestIdentity; id: string }> = {};
  const ps = closedPeriodStart();
  const sheets: Record<string, string> = {};

  function w(name: string) {
    const worker = workers[name];
    if (!worker) throw new Error(`unknown worker ${name}`);
    return worker;
  }

  async function lockedTimesheet(
    name: string,
    shifts: { day: number; start: string; end: string }[],
  ) {
    let assignmentId = "";
    for (const shift of shifts) {
      const date = addDays(ps, shift.day);
      assignmentId = (
        await pastWork({
          scheduler,
          organisationId: alphaId,
          facilityId: river.facilityId,
          locationId: river.locationId,
          workerId: w(name).id,
          workerProfileId: w(name).identity.userId,
          startAt: localInstant(date, shift.start, CHICAGO),
          endAt: localInstant(date, shift.end, CHICAGO),
          events: [
            { type: "clock_in", at: localInstant(date, shift.start, CHICAGO) },
            { type: "clock_out", at: localInstant(date, shift.end, CHICAGO) },
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
    const timesheetId = entry?.timesheet_id ?? "";
    await run(w(name).identity.client.rpc("submit_timesheet", { p_timesheet_id: timesheetId }));
    await run(
      admin.client.rpc("approve_timesheet", {
        p_timesheet_id: timesheetId,
        p_expected_revision: 1,
      }),
    );
    return timesheetId;
  }

  async function price(timesheetId: string, revision: number) {
    const [result] = await must(
      finance.client.rpc("price_timesheet", {
        p_timesheet_id: timesheetId,
        p_expected_revision: revision,
      }),
    );
    expect(result?.outcome).toMatch(/priced|existing/);
  }

  async function download(identity: TestIdentity, exportId: string) {
    return identity.client.rpc("download_financial_export", { p_export_id: exportId });
  }

  /** Refusals are returned (and audited) by the database, not raised. */
  async function deniedReason(identity: TestIdentity, exportId: string) {
    const { data, error } = await download(identity, exportId);
    if (error) throw error;
    return data[0]?.denied_reason ?? null;
  }

  beforeAll(async () => {
    [admin, betaAdmin] = await Promise.all([signUpVerified("fn-alpha"), signUpVerified("fn-beta")]);
    alphaId = await createAgency(admin, "Alpha Finance Staffing");
    betaId = await createAgency(betaAdmin, "Beta Finance Staffing");
    await Promise.all([stepUpToAal2(admin), stepUpToAal2(betaAdmin)]);
    scheduler = await invite(admin.client, alphaId, "agency.scheduler", uniqueEmail("fn-sched"));
    finance = await invite(admin.client, alphaId, "agency.finance", uniqueEmail("fn-fin"));
    finance2 = await invite(admin.client, alphaId, "agency.finance", uniqueEmail("fn-fin2"));
    opsManager = await invite(
      admin.client,
      alphaId,
      "agency.operations_manager",
      uniqueEmail("fn-ops"),
    );
    await Promise.all([stepUpToAal2(finance), stepUpToAal2(finance2), stepUpToAal2(opsManager)]);
    await run(
      admin.client.rpc("create_credential_requirement", {
        p_effective_from: isoDay(-30),
        p_agency_organisation_id: alphaId,
        p_credential_type_key: "bls_certification",
      }),
    );
    for (const name of ["wendy", "walt"]) {
      const identity = await invite(
        admin.client,
        alphaId,
        "agency.healthcare_worker",
        uniqueEmail(`fn-${name}`),
      );
      const id = await workerIdAt(identity, alphaId);
      await activateCna(admin.client, id);
      await blsEvidence(identity, 400, [{ client: admin.client, organisationId: alphaId }]);
      workers[name] = { identity, id };
    }
    river = await facilityWithRelationship(admin.client, alphaId, "Riverside", CHICAGO);

    // A facility organisation (for the "facility is denied" checks).
    const operator = await signUpVerified("fn-operator");
    await grantPlatformAdmin(operator.userId);
    await stepUpToAal2(operator);
    const email = uniqueEmail("fn-gamma");
    const created = await must(
      operator.client.rpc("platform_create_organisation", {
        p_type: "facility",
        p_name: "Gamma Health Finance",
        p_slug: slug("gamma-fn"),
        p_owner_email: email,
      }),
    );
    gammaAdmin = await signUpVerified("fn-gamma", email);
    await run(
      gammaAdmin.client.rpc("accept_organisation_invite", {
        p_token: created[0]?.invite_token ?? "",
      }),
    );
    await stepUpToAal2(gammaAdmin);

    // Riverside: $42.50 pay / $58.00 bill per hour.
    const cardId = await must(
      finance.client.rpc("create_rate_card", {
        p_organisation_id: alphaId,
        p_discipline_key: "cna",
        p_relationship_id: river.relationshipId,
      }),
    );
    const versionId = await must(
      finance.client.rpc("create_rate_version", {
        p_rate_card_id: cardId,
        p_currency: "USD",
        p_pay_rate_minor: 4250,
        p_bill_rate_minor: 5800,
        p_effective_from: addDays(ps, -30),
      }),
    );
    await run(finance.client.rpc("activate_rate_version", { p_version_id: versionId }));

    sheets.wendy = await lockedTimesheet("wendy", [
      { day: 1, start: "09:00", end: "17:00" },
      { day: 2, start: "09:00", end: "16:33" },
    ]);
    sheets.walt = await lockedTimesheet("walt", [{ day: 3, start: "09:00", end: "13:00" }]);
    await price(sheets.wendy, 1);
    await price(sheets.walt, 1);
  }, 300_000);

  let batchId: string;
  let draftId: string;

  it("two finance users preparing the same period at once: exactly one batch wins", async () => {
    const attempts = await Promise.all([
      finance.client.rpc("create_payroll_batch", {
        p_organisation_id: alphaId,
        p_period_start: ps,
        p_currency: "USD",
      }),
      finance2.client.rpc("create_payroll_batch", {
        p_organisation_id: alphaId,
        p_period_start: ps,
        p_currency: "USD",
      }),
    ]);
    const winners = attempts.filter((attempt) => !attempt.error);
    const losers = attempts.filter((attempt) => attempt.error);
    expect(winners).toHaveLength(1);
    expect(losers.map((attempt) => attempt.error?.code)).toEqual([
      expect.stringMatching(/^CHY(01|10)$/),
    ]);
    batchId = winners[0]?.data ?? "";
    const claims = await must(
      finance.client.from("payroll_line_claims").select("priced_line_id, payroll_batch_id"),
    );
    expect(claims).toHaveLength(3);
    expect(new Set(claims.map((claim) => claim.payroll_batch_id))).toEqual(new Set([batchId]));
  });

  it("money: batch amounts equal the priced pay amounts exactly", async () => {
    const [batch] = await must(finance.client.rpc("get_payroll_batch", { p_batch_id: batchId }));
    const priced = await must(finance.client.from("priced_timesheets").select("total_pay_minor"));
    expect(batch?.total_pay_minor).toBe(priced.reduce((sum, row) => sum + row.total_pay_minor, 0));
    expect(batch?.total_pay_minor).toBe(83088); // $340.00 + $320.88 + $170.00
    expect(batch?.reference).toMatch(/^PAY-\d{4}-000001$/);
    const lines = await must(
      finance.client.rpc("list_payroll_batch_lines", { p_batch_id: batchId }),
    );
    expect(lines.map((line) => line.pay_amount_minor).sort((a, b) => a - b)).toEqual([
      17000, 32088, 34000,
    ]);
  });

  it("the operations manager sees but cannot approve; a scheduler cannot see", async () => {
    const view = await opsManager.client.rpc("list_payroll_batches", {
      p_organisation_id: alphaId,
    });
    expect(view.data).toHaveLength(1);
    await run(finance.client.rpc("review_payroll_batch", { p_batch_id: batchId }));
    const approve = await opsManager.client.rpc("approve_payroll_batch", { p_batch_id: batchId });
    expect(approve.data?.[0]).toEqual({ outcome: "denied", reason_code: "NOT_PERMITTED" });
    const scheduled = await scheduler.client.rpc("approve_payroll_batch", { p_batch_id: batchId });
    expect(scheduled.data?.[0]).toEqual({ outcome: "denied", reason_code: "NOT_FOUND" });
  });

  it("approve → lock → export: a deterministic CSV with a verifiable checksum", async () => {
    await run(finance.client.rpc("approve_payroll_batch", { p_batch_id: batchId }));
    await run(finance.client.rpc("lock_payroll_batch", { p_batch_id: batchId }));
    const first = await must(finance.client.rpc("create_payroll_export", { p_batch_id: batchId }));
    const second = await must(finance.client.rpc("create_payroll_export", { p_batch_id: batchId }));
    const [a] = await must(download(finance, first));
    const [b] = await must(download(finance, second));
    const bytes = Buffer.from(a?.content_base64 ?? "", "base64");
    expect(sha256(bytes)).toBe(a?.sha256);
    expect(b?.sha256).toBe(a?.sha256);
    expect(bytes.length).toBe(a?.byte_size);
    expect(a?.file_name).toMatch(/^PAY-\d{4}-000001\.csv$/);
    const text = bytes.toString("utf8");
    const rows = text.split("\r\n");
    expect(rows[0]).toBe(PAYROLL_CSV_COLUMNS.join(","));
    expect(rows).toHaveLength(5); // header + 3 rows + trailing CRLF
    expect(text).toContain(",480,0,4250,34000,");
    const exports = await must(
      finance.client.rpc("list_financial_exports", {
        p_source_type: "payroll_batch",
        p_source_id: batchId,
      }),
    );
    expect(exports.map((row) => row.export_number).sort()).toEqual([1, 2]);
    expect(exports[0]).toEqual(
      expect.objectContaining({ row_count: 3, total_minor: 83088, currency: "USD" }),
    );
    const audit = await must(
      admin.client.from("audit_events").select("action").eq("target_id", first),
    );
    expect(audit.map((row) => row.action).sort()).toEqual([
      "payroll.export_created",
      "payroll.export_downloaded",
    ]);
  });

  it("downloads: wrong tenant, worker, facility, scheduler and view-only are refused", async () => {
    const [exp] = await must(
      finance.client.rpc("list_financial_exports", {
        p_source_type: "payroll_batch",
        p_source_id: batchId,
      }),
    );
    const id = exp?.financial_export_id ?? "";
    expect(await deniedReason(betaAdmin, id)).toBe("NOT_FOUND");
    expect(await deniedReason(w("wendy").identity, id)).toBe("NOT_FOUND");
    expect(await deniedReason(gammaAdmin, id)).toBe("NOT_FOUND");
    expect(await deniedReason(scheduler, id)).toBe("NOT_FOUND");
    expect(await deniedReason(opsManager, id)).toBe("NOT_PERMITTED");
    const tables = await w("wendy").identity.client.from("financial_exports").select("id");
    expect(tables.data).toEqual([]);
  });

  it("a member removed from the agency can no longer download (nothing to replay)", async () => {
    const [exp] = await must(
      finance.client.rpc("list_financial_exports", {
        p_source_type: "payroll_batch",
        p_source_id: batchId,
      }),
    );
    const id = exp?.financial_export_id ?? "";
    expect(await deniedReason(finance2, id)).toBeNull();
    const [membership] = await must(
      admin.client
        .from("organisation_memberships")
        .select("id")
        .eq("organisation_id", alphaId)
        .eq("profile_id", finance2.userId),
    );
    await run(
      admin.client.rpc("set_membership_status", {
        p_membership_id: membership?.id ?? "",
        p_status: "suspended",
      }),
    );
    expect(await deniedReason(finance2, id)).toBe("NOT_FOUND");
  });

  it("export bytes are not reachable directly by any API role", async () => {
    const direct = await finance.client
      .schema("internal" as "public")
      .from("financial_export_files" as "financial_exports")
      .select("*");
    expect(direct.error).not.toBeNull();
  });

  it("invoice drafting is bill-side only and concurrent drafting yields one draft", async () => {
    const attempts = await Promise.all(
      [finance, admin].map((identity) =>
        identity.client.rpc("create_invoice_draft", {
          p_organisation_id: alphaId,
          p_relationship_id: river.relationshipId,
          p_period_start: ps,
          p_currency: "USD",
        }),
      ),
    );
    const winners = attempts.filter((attempt) => !attempt.error);
    expect(winners).toHaveLength(1);
    draftId = winners[0]?.data ?? "";
    const [draft] = await must(finance.client.rpc("get_invoice_draft", { p_draft_id: draftId }));
    expect(draft?.total_bill_minor).toBe(113390); // $464.00 + $437.90 + $232.00
    expect(draft?.reference).toMatch(/^INV-DRAFT-\d{4}-000001$/);
    const lines = await must(
      finance.client.rpc("list_invoice_draft_lines", { p_draft_id: draftId }),
    );
    for (const line of lines) {
      expect(Object.keys(line).some((key) => key.includes("pay") || key.includes("margin"))).toBe(
        false,
      );
    }
    for (const step of [
      "review_invoice_draft",
      "approve_invoice_draft",
      "lock_invoice_draft",
    ] as const) {
      await run(finance.client.rpc(step, { p_draft_id: draftId }));
    }
    const csv = await must(
      finance.client.rpc("create_invoice_export", { p_draft_id: draftId, p_format: "csv" }),
    );
    const pdf = await must(
      finance.client.rpc("create_invoice_export", { p_draft_id: draftId, p_format: "pdf" }),
    );
    const [csvFile] = await must(download(finance, csv));
    const [pdfFile] = await must(download(finance, pdf));
    const csvText = Buffer.from(csvFile?.content_base64 ?? "", "base64").toString("utf8");
    expect(csvText.split("\r\n")[0]).toBe(INVOICE_CSV_COLUMNS.join(","));
    expect(csvText).not.toMatch(/,(4250|34000|32088|17000),/);
    expect(csvFile?.file_name).toMatch(/-DRAFT-INVOICE\.csv$/);
    const pdfBytes = Buffer.from(pdfFile?.content_base64 ?? "", "base64");
    expect(pdfBytes.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    expect(pdfBytes.toString("latin1")).toContain("(DRAFT INVOICE)");
    expect(sha256(pdfBytes)).toBe(pdfFile?.sha256);
    expect(pdfFile?.content_type).toBe("application/pdf");
  });

  it("a facility and another agency cannot read internal invoice drafts", async () => {
    expect((await gammaAdmin.client.from("invoice_drafts").select("id")).data).toEqual([]);
    expect((await betaAdmin.client.from("invoice_drafts").select("id")).data).toEqual([]);
    const cross = await betaAdmin.client.rpc("list_invoice_drafts", { p_organisation_id: alphaId });
    expect(cross.error?.code).toBe("CH403");
    const own = await betaAdmin.client.rpc("list_invoice_drafts", { p_organisation_id: betaId });
    expect(own.data).toEqual([]);
  });

  it("a new priced revision after lock leaves both documents intact and flags an adjustment", async () => {
    await run(
      admin.client.rpc("reopen_timesheet", {
        p_timesheet_id: sheets.wendy ?? "",
        p_reason: "approved_in_error",
      }),
    );
    await run(
      w("wendy").identity.client.rpc("submit_timesheet", { p_timesheet_id: sheets.wendy ?? "" }),
    );
    await run(
      admin.client.rpc("approve_timesheet", {
        p_timesheet_id: sheets.wendy ?? "",
        p_expected_revision: 2,
      }),
    );
    // A later rate version ($44.00 / $60.00 from day 2) makes revision 2 financially different.
    const [card] = await must(
      finance.client.from("rate_cards").select("id").eq("agency_organisation_id", alphaId),
    );
    const later = await must(
      finance.client.rpc("create_rate_version", {
        p_rate_card_id: card?.id ?? "",
        p_currency: "USD",
        p_pay_rate_minor: 4400,
        p_bill_rate_minor: 6000,
        p_effective_from: addDays(ps, 2),
      }),
    );
    await run(finance.client.rpc("activate_rate_version", { p_version_id: later }));
    await price(sheets.wendy ?? "", 2);

    const [batch] = await must(finance.client.rpc("get_payroll_batch", { p_batch_id: batchId }));
    expect(batch).toEqual(
      expect.objectContaining({
        status: "exported",
        total_pay_minor: 83088,
        attention: "ADJUSTMENT_REQUIRED",
      }),
    );
    const [draft] = await must(finance.client.rpc("get_invoice_draft", { p_draft_id: draftId }));
    expect(draft).toEqual(
      expect.objectContaining({
        status: "exported",
        total_bill_minor: 113390,
        attention: "ADJUSTMENT_REQUIRED",
      }),
    );
    const work = await must(
      finance.client.rpc("list_payroll_work", { p_organisation_id: alphaId }),
    );
    expect(work).toEqual([expect.objectContaining({ adjustment_required: true, line_count: 2 })]);
    const blocked = await finance.client.rpc("create_payroll_batch", {
      p_organisation_id: alphaId,
      p_period_start: ps,
      p_currency: "USD",
    });
    expect(blocked.error?.code).toBe("CHY01");
    const issues = await must(
      finance.client.rpc("list_invoice_issues", { p_organisation_id: alphaId }),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        issue_code: "ADJUSTMENT_REQUIRED",
        document_references: [`${draft?.reference} (exported)`],
      }),
    ]);
    const files = await ownerQuery(
      (sql) => sql<{ ok: boolean }[]>`
        select bool_and(encode(extensions.digest(f.content, 'sha256'), 'hex') = e.sha256) as ok
        from internal.financial_export_files f join public.financial_exports e on e.id = f.export_id
        where e.agency_organisation_id = ${alphaId}::uuid`,
    );
    expect(files[0]?.ok).toBe(true);
  });
});
