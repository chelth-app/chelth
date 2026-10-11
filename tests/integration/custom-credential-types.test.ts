import { beforeAll, describe, expect, it } from "vitest";

import { CREDENTIAL_DOCUMENT_BUCKET } from "@/lib/domain/credentials";

import { uniqueEmail } from "../support/mailpit";
import { isoDay } from "./support/staffing";
import {
  ownerQuery,
  signUpVerified,
  slug,
  stepUpToAal2,
  type TestClient,
  type TestIdentity,
} from "./support/identities";

/*
 * P0-E9-3J: agency-defined credential / requirement types, end to end through
 * the API: creation, tenant isolation, the worker evidence flow and readiness.
 */

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n% Chelth custom type test\n%%EOF\n");

async function createAgency(owner: TestIdentity, name: string): Promise<string> {
  const { data, error } = await owner.client.rpc("create_organisation", {
    p_type: "agency",
    p_name: name,
    p_slug: slug("agency"),
  });
  if (error) throw error;
  return data;
}

async function invite(admin: TestClient, organisationId: string, role: string, who: TestIdentity) {
  const issued = await admin.rpc("create_organisation_invite", {
    p_organisation_id: organisationId,
    p_email: who.email,
    p_role_key: role,
  });
  if (issued.error) throw issued.error;
  const accepted = await who.client.rpc("accept_organisation_invite", {
    p_token: issued.data[0]?.invite_token ?? "",
  });
  if (accepted.error) throw accepted.error;
}

async function uploadClean(owner: TestIdentity, versionId: string) {
  const begun = await owner.client.rpc("begin_credential_document_upload", {
    p_credential_version_id: versionId,
    p_mime_type: "application/pdf",
    p_size_bytes: PDF_BYTES.byteLength,
  });
  if (begun.error) throw begun.error;
  const { document_id: documentId = "", object_path: path = "" } = begun.data[0] ?? {};
  const ticket = await owner.client.storage
    .from(CREDENTIAL_DOCUMENT_BUCKET)
    .createSignedUploadUrl(path);
  if (ticket.error) throw ticket.error;
  const uploaded = await owner.client.storage
    .from(CREDENTIAL_DOCUMENT_BUCKET)
    .uploadToSignedUrl(ticket.data.path, ticket.data.token, PDF_BYTES, {
      contentType: "application/pdf",
    });
  if (uploaded.error) throw uploaded.error;
  const completed = await owner.client.rpc("complete_credential_document_upload", {
    p_document_id: documentId,
    p_sha256: "b".repeat(64),
    p_content_valid: true,
  });
  if (completed.error) throw completed.error;
  await ownerQuery(
    (sql) => sql`select internal.record_document_scan_result(${documentId}::uuid, 'clean')`,
  );
}

describe("custom credential types (P0-E9-3J)", () => {
  let admin: TestIdentity;
  let betaAdmin: TestIdentity;
  let worker: TestIdentity;
  let alphaId: string;
  let betaId: string;
  let alphaWorkerId: string;
  let betaWorkerId: string;
  let typeKey: string;
  let requirementId: string;

  beforeAll(async () => {
    [admin, betaAdmin, worker] = await Promise.all([
      signUpVerified("custom-admin"),
      signUpVerified("custom-beta"),
      signUpVerified("custom-worker", uniqueEmail("custom-worker")),
    ]);
    [alphaId, betaId] = await Promise.all([
      createAgency(admin, "Alpha Custom Staffing"),
      createAgency(betaAdmin, "Beta Custom Staffing"),
    ]);
    await Promise.all([stepUpToAal2(admin), stepUpToAal2(betaAdmin)]);
    await invite(admin.client, alphaId, "agency.healthcare_worker", worker);
    await invite(betaAdmin.client, betaId, "agency.healthcare_worker", worker);
    const workers = await worker.client.from("agency_workers").select("id, agency_organisation_id");
    alphaWorkerId = workers.data?.find((row) => row.agency_organisation_id === alphaId)?.id ?? "";
    betaWorkerId = workers.data?.find((row) => row.agency_organisation_id === betaId)?.id ?? "";
    for (const [client, id] of [
      [admin.client, alphaWorkerId],
      [betaAdmin.client, betaWorkerId],
    ] as const) {
      const activated = await client.rpc("set_agency_worker_status", {
        p_worker_id: id,
        p_status: "active",
      });
      if (activated.error) throw activated.error;
    }
  });

  it("an agency creates a custom type; duplicate names are refused", async () => {
    const created = await admin.client.rpc("create_custom_credential_type", {
      p_organisation_id: alphaId,
      p_name: "Driver License",
      p_category: "other",
      p_requires_document: true,
      p_requires_expiry_date: true,
      p_requires_verification: true,
      p_requires_credential_number: false,
      p_instructions: "Upload the front of your license.",
    });
    expect(created.error).toBeNull();
    typeKey = created.data ?? "";
    expect(typeKey).toMatch(/^custom_[0-9a-f]{32}$/);

    const duplicate = await admin.client.rpc("create_custom_credential_type", {
      p_organisation_id: alphaId,
      p_name: "  driver license ",
      p_category: "other",
      p_requires_document: true,
      p_requires_expiry_date: true,
      p_requires_verification: true,
      p_requires_credential_number: false,
    });
    expect(duplicate.error?.code).toBe("CHC01");

    // The same name is fine in another agency: names are per tenant.
    const elsewhere = await betaAdmin.client.rpc("create_custom_credential_type", {
      p_organisation_id: betaId,
      p_name: "Driver License",
      p_category: "other",
      p_requires_document: true,
      p_requires_expiry_date: true,
      p_requires_verification: true,
      p_requires_credential_number: false,
    });
    expect(elsewhere.error).toBeNull();
    expect(elsewhere.data).not.toBe(typeKey);
  });

  it("is invisible and unusable outside its agency", async () => {
    const seen = await betaAdmin.client.from("credential_types").select("key").eq("key", typeKey);
    expect(seen.data).toEqual([]);
    const listed = await betaAdmin.client.rpc("list_custom_credential_types", {
      p_organisation_id: betaId,
    });
    expect(listed.data?.map((row) => row.key)).not.toContain(typeKey);
    const requirement = await betaAdmin.client.rpc("create_credential_requirement", {
      p_effective_from: isoDay(-1),
      p_agency_organisation_id: betaId,
      p_credential_type_key: typeKey,
    });
    expect(requirement.error).not.toBeNull();
    const edit = await betaAdmin.client.rpc("update_custom_credential_type", {
      p_key: typeKey,
      p_name: "Hijacked",
      p_category: "other",
      p_requires_document: false,
      p_requires_expiry_date: false,
      p_requires_verification: false,
      p_requires_credential_number: false,
    });
    expect(edit.error).not.toBeNull();
    const peek = await betaAdmin.client.rpc("list_custom_credential_types", {
      p_organisation_id: alphaId,
    });
    expect(peek.error?.code).toBe("CH403");
  });

  it("works as a baseline requirement: missing until the worker provides verified evidence", async () => {
    const requirement = await admin.client.rpc("create_credential_requirement", {
      p_effective_from: isoDay(-1),
      p_agency_organisation_id: alphaId,
      p_credential_type_key: typeKey,
    });
    expect(requirement.error).toBeNull();
    requirementId = requirement.data ?? "";
    const missing = await admin.client.rpc("evaluate_worker_compliance", {
      p_agency_worker_id: alphaWorkerId,
    });
    expect(missing.data?.map((row) => [row.credential_type_key, row.reason])).toEqual([
      [typeKey, "MISSING_CREDENTIAL"],
    ]);
    // Agency B's workers are untouched by Agency A's requirement.
    const beta = await betaAdmin.client.rpc("worker_readiness", {
      p_agency_worker_id: betaWorkerId,
    });
    expect(beta.data?.[0]?.readiness).toBe("ready");

    // The worker sees the type (and its instructions) through their Alpha membership.
    const visible = await worker.client
      .from("credential_types")
      .select("name, instructions")
      .eq("key", typeKey)
      .single();
    expect(visible.data).toEqual({
      name: "Driver License",
      instructions: "Upload the front of your license.",
    });

    const created = await worker.client.rpc("create_credential", {
      p_credential_type_key: typeKey,
      p_issuing_authority: "State DMV",
      p_expiry_date: isoDay(400),
    });
    expect(created.error).toBeNull();
    const credentialId = created.data?.[0]?.credential_id ?? "";
    const versionId = created.data?.[0]?.credential_version_id ?? "";

    const toBeta = await worker.client.rpc("share_credential", {
      p_credential_id: credentialId,
      p_agency_organisation_id: betaId,
    });
    expect(toBeta.error?.code).toBe("CH403");
    const toAlpha = await worker.client.rpc("share_credential", {
      p_credential_id: credentialId,
      p_agency_organisation_id: alphaId,
    });
    expect(toAlpha.error).toBeNull();

    await uploadClean(worker, versionId);
    const submitted = await worker.client.rpc("submit_credential_version", {
      p_credential_version_id: versionId,
    });
    expect(submitted.error).toBeNull();
    const unverified = await admin.client.rpc("evaluate_worker_compliance", {
      p_agency_worker_id: alphaWorkerId,
    });
    expect(unverified.data?.map((row) => row.reason)).toEqual(["UNVERIFIED_CREDENTIAL"]);

    const verified = await admin.client.rpc("record_credential_verification", {
      p_credential_version_id: versionId,
      p_agency_organisation_id: alphaId,
      p_outcome: "verified",
    });
    expect(verified.error).toBeNull();
    const ready = await admin.client.rpc("worker_readiness", { p_agency_worker_id: alphaWorkerId });
    expect(ready.data?.[0]?.readiness).toBe("ready");
  });

  it("once used, evidence rules are locked but the name stays editable; archiving waits for requirements", async () => {
    const base = {
      p_key: typeKey,
      p_category: "other" as const,
      p_requires_document: true,
      p_requires_expiry_date: true,
      p_requires_verification: true,
      p_requires_credential_number: false,
    };
    const loosen = await admin.client.rpc("update_custom_credential_type", {
      ...base,
      p_name: "Driver License",
      p_requires_verification: false,
    });
    expect(loosen.error?.code).toBe("CHC02");
    const rename = await admin.client.rpc("update_custom_credential_type", {
      ...base,
      p_name: "Driver's License",
    });
    expect(rename.error).toBeNull();

    const archive = await admin.client.rpc("set_custom_credential_type_active", {
      p_key: typeKey,
      p_active: false,
    });
    expect(archive.error?.code).toBe("CHC02");
    const deactivated = await admin.client.rpc("update_credential_requirement", {
      p_requirement_id: requirementId,
      p_must_be_verified: true,
      p_minimum_validity_days: 0,
      p_expiry_warning_days: 30,
      p_status: "inactive",
      p_effective_until: isoDay(0),
    });
    expect(deactivated.error).toBeNull();
    const archived = await admin.client.rpc("set_custom_credential_type_active", {
      p_key: typeKey,
      p_active: false,
    });
    expect(archived.error).toBeNull();

    const listed = await admin.client.rpc("list_custom_credential_types", {
      p_organisation_id: alphaId,
    });
    const row = listed.data?.find((type) => type.key === typeKey);
    expect(row).toMatchObject({
      name: "Driver's License",
      is_active: false,
      requirement_count: 1,
      active_requirement_count: 0,
      credential_count: 1,
    });
    const audit = await admin.client
      .from("audit_events")
      .select("action")
      .eq("organisation_id", alphaId)
      .like("action", "credential_type.custom_%");
    expect(audit.data?.map((event) => event.action).sort()).toEqual([
      "credential_type.custom_archived",
      "credential_type.custom_created",
      "credential_type.custom_updated",
    ]);
  });

  it("supports a requirement with no document, verified by the agency", async () => {
    const created = await admin.client.rpc("create_custom_credential_type", {
      p_organisation_id: alphaId,
      p_name: "Orientation completed",
      p_category: "orientation",
      p_requires_document: false,
      p_requires_expiry_date: false,
      p_requires_verification: true,
      p_requires_credential_number: false,
    });
    expect(created.error).toBeNull();
    const credential = await worker.client.rpc("create_credential", {
      p_credential_type_key: created.data ?? "",
    });
    expect(credential.error).toBeNull();
    const versionId = credential.data?.[0]?.credential_version_id ?? "";
    await worker.client.rpc("share_credential", {
      p_credential_id: credential.data?.[0]?.credential_id ?? "",
      p_agency_organisation_id: alphaId,
    });
    const submitted = await worker.client.rpc("submit_credential_version", {
      p_credential_version_id: versionId,
    });
    expect(submitted.error).toBeNull();
    const verified = await admin.client.rpc("record_credential_verification", {
      p_credential_version_id: versionId,
      p_agency_organisation_id: alphaId,
      p_outcome: "verified",
    });
    expect(verified.error).toBeNull();
  });
});
